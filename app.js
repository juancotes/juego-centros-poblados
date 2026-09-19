'use strict';

const DATA_URL = './data/centros.json';
const AMAZON_BOUNDARY_URL = 'https://gis.siatac.co/arcgis/rest/services/UER_Limites/Cartografia_Base/FeatureServer/1/query?where=1%3D1&outFields=objectid_1&returnGeometry=true&outSR=4326&f=geojson';
const DEPARTMENT_BOUNDARY_URL = 'https://geoportal.dane.gov.co/mparcgis/rest/services/Divipola/Serv_DIVIPOLA_MGN_2025/FeatureServer/319/query?where=1%3D1&outFields=DPTO_CCDGO,DPTO_CNMBRE&returnGeometry=true&outSR=4326&f=geojson';
const QUERY_ALIASES = new Map([
  ['PASTO','SAN JUAN DE PASTO'],
  ['QUIBDO','SAN FRANCISCO DE QUIBDÓ']
]);

const state = {
  data: null,
  mode: null,
  scope: 'all',
  guessed: new Set(),
  markers: new Map(),
  revealed: new Map(),
  amazonIds: null,
  amazonBoundary: null,
  departmentGeoJSON: null,
  departmentLayer: null,
  amazonLayer: null,
  toastTimer: null,
  lowPopulationPctByValue: new Map(),
  foundSort: 'isolation',
};

const $ = (id) => document.getElementById(id);
const els = {
  landing: $('landing'), gameUI: $('gameUI'), resumeBtn: $('resumeBtn'), guessInput: $('guessInput'), scopeSelect: $('scopeSelect'),
  submitGuess: $('submitGuess'), placeCount: $('placeCount'), populationCount: $('populationCount'), populationPct: $('populationPct'),
  isolatedList: $('isolatedList'), leastPopulatedList: $('leastPopulatedList'), rankPanel: $('rankPanel'),
  collapseRank: $('collapseRank'), openRank: $('openRank'), toast: $('toast'), finishBtn: $('finishBtn'),
  homeBtn: $('homeBtn'), modeTitle: $('modeTitle'), homonymModal: $('homonymModal'), homonymTitle: $('homonymTitle'),
  homonymChoices: $('homonymChoices'), foundPlacesBtn: $('foundPlacesBtn'), foundPlacesModal: $('foundPlacesModal'),
  foundPlacesMeta: $('foundPlacesMeta'), foundPlacesList: $('foundPlacesList'), summaryModal: $('summaryModal'), summaryTitle: $('summaryTitle'),
  summaryPlaces: $('summaryPlaces'), summaryPopulation: $('summaryPopulation'), summaryPop: $('summaryPop'), summaryIsolated: $('summaryIsolated'),
  summaryLeastPopulated: $('summaryLeastPopulated'), continueBtn: $('continueBtn'), revealBtn: $('revealBtn')
};

const map = L.map('map', {zoomControl:false, attributionControl:true, preferCanvas:true, minZoom:3, maxZoom:18})
  .setView([4.4, -73.4], 5.2);
L.control.zoom({position:'bottomright'}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom:18,
  attribution:'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
}).addTo(map);
document.body.classList.add('landing');


const mobileUI = window.matchMedia('(max-width: 760px)');
let mobileViewportBaseline = Math.max(window.innerHeight, window.visualViewport?.height || 0);

function isMobileUI(){ return mobileUI.matches; }

function collapseMobileRank(){
  if(!isMobileUI()) return;
  els.rankPanel.classList.add('hidden');
  els.openRank.classList.remove('hidden');
}

function syncMobileViewport(){
  const vv=window.visualViewport;
  const currentHeight=vv?.height || window.innerHeight;
  const offsetTop=vv?.offsetTop || 0;

  // Actualiza la referencia solo cuando no se está escribiendo. Así distinguimos
  // el teclado de cambios pequeños de las barras del navegador.
  if(document.activeElement!==els.guessInput){
    mobileViewportBaseline=Math.max(mobileViewportBaseline,window.innerHeight,currentHeight);
  }

  const keyboardByHeight=mobileViewportBaseline-currentHeight>120;
  const keyboardByInset=vv ? (window.innerHeight-currentHeight-offsetTop)>120 : false;
  const keyboardOpen=isMobileUI() && document.activeElement===els.guessInput && (keyboardByHeight || keyboardByInset);
  const inset=Math.max(0,window.innerHeight-currentHeight-offsetTop);

  document.documentElement.style.setProperty('--keyboard-inset',`${keyboardOpen?inset:0}px`);
  document.body.classList.toggle('keyboard-open',keyboardOpen);
}

function blurMobileKeyboard(){
  if(isMobileUI() && document.activeElement===els.guessInput) els.guessInput.blur();
}

if(window.visualViewport){
  window.visualViewport.addEventListener('resize',syncMobileViewport);
  window.visualViewport.addEventListener('scroll',syncMobileViewport);
}
window.addEventListener('resize',()=>{
  if(!isMobileUI()) document.body.classList.remove('keyboard-open');
  syncMobileViewport();
});
window.addEventListener('orientationchange',()=>setTimeout(()=>{
  mobileViewportBaseline=Math.max(window.innerHeight,window.visualViewport?.height || 0);
  syncMobileViewport();
},300));
if(mobileUI.addEventListener) mobileUI.addEventListener('change',()=>{
  mobileViewportBaseline=Math.max(window.innerHeight,window.visualViewport?.height || 0);
  document.body.classList.remove('keyboard-open');
  syncMobileViewport();
});
els.guessInput.addEventListener('focus',()=>setTimeout(syncMobileViewport,60));
els.guessInput.addEventListener('blur',()=>setTimeout(syncMobileViewport,100));
map.on('click',blurMobileKeyboard);

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function fmtInt(n){ return new Intl.NumberFormat('es-CO').format(Math.round(n)); }
function fmtPct(x){ return `${(x*100).toFixed(x >= .1 ? 1 : 2).replace('.', ',')}%`; }
function fmtTopPct(x){
  if(x === null || x === undefined || !Number.isFinite(x)) return '—';
  const digits=x<0.1?2:1;
  return `${x.toFixed(digits).replace('.', ',')}%`;
}
function escapeHtml(s){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function populationColor(p){
  if(p === null || p === undefined) return '#96a29a';
  if(p < 100) return '#d7f2df';
  if(p < 500) return '#a9dfb8';
  if(p < 2000) return '#72c58d';
  if(p < 10000) return '#3a9d67';
  if(p < 100000) return '#197247';
  return '#0a4b31';
}

function buildPopulationPercentiles(){
  state.lowPopulationPctByValue.clear();
  const values=state.data.places.filter(p=>p.p!==null && p.p!==undefined).map(p=>Number(p.p)).sort((a,b)=>a-b);
  if(!values.length) return;
  let i=0;
  while(i<values.length){
    const value=values[i];
    let j=i+1;
    while(j<values.length && values[j]===value) j++;
    state.lowPopulationPctByValue.set(value,(j/values.length)*100);
    i=j;
  }
}
function isolationTopPct(p){
  const total=Number(state.data?.meta?.records)||state.data?.places?.length||0;
  return p?.ar && total ? (Number(p.ar)/total)*100 : null;
}
function lowPopulationTopPct(p){
  if(p?.p===null || p?.p===undefined) return null;
  return state.lowPopulationPctByValue.get(Number(p.p)) ?? null;
}
function isolationLabel(p){ const x=isolationTopPct(p); return x===null?'—':`Top ${fmtTopPct(x)}`; }
function lowPopulationLabel(p){ const x=lowPopulationTopPct(p); return x===null?'sin dato':`Top ${fmtTopPct(x)}`; }

function pointInRing(point, ring){
  const [x,y]=point; let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    const hit=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-15)+xi);
    if(hit) inside=!inside;
  }
  return inside;
}
function pointInPolygon(point, coords){
  if(!coords.length || !pointInRing(point,coords[0])) return false;
  for(let i=1;i<coords.length;i++) if(pointInRing(point,coords[i])) return false;
  return true;
}
function pointInGeometry(point, geometry){
  if(!geometry) return false;
  if(geometry.type==='Polygon') return pointInPolygon(point,geometry.coordinates);
  if(geometry.type==='MultiPolygon') return geometry.coordinates.some(poly=>pointInPolygon(point,poly));
  return false;
}
function pointInFeatureCollection(point, fc){
  return fc?.features?.some(f=>pointInGeometry(point,f.geometry)) ?? false;
}

function isAmazonPlace(p){
  return state.amazonIds ? state.amazonIds.has(p.id) : p.af;
}
function baseModePlaces(){
  const all=state.data.places;
  return state.mode==='amazon' ? all.filter(isAmazonPlace) : all;
}
function scopePlaces(){
  let list=baseModePlaces();
  if(state.scope!=='all') list=list.filter(p=>p.dep===Number(state.scope));
  return list;
}
function guessedInScope(){
  const allowed=new Set(scopePlaces().map(p=>p.id));
  return state.data.places.filter(p=>state.guessed.has(p.id)&&allowed.has(p.id));
}
function populationStats(){
  const scoped=scopePlaces();
  const guessed=guessedInScope();
  const totalPop=scoped.reduce((s,p)=>s+(p.p??0),0);
  const guessedPop=guessed.reduce((s,p)=>s+(p.p??0),0);
  return {scoped, guessed, totalPop, guessedPop};
}

function setLanding(on){
  els.landing.classList.toggle('hidden',!on);
  els.gameUI.classList.toggle('hidden',on);
  document.body.classList.toggle('landing',on);
}

function buildScopeOptions(){
  const modePlaces=baseModePlaces();
  const depCodes=[...new Set(modePlaces.map(p=>p.dep))];
  const depMap=new Map(state.data.departments.map(d=>[d.code,d.name]));
  const prior=state.scope;
  els.scopeSelect.innerHTML='';
  const all=document.createElement('option');
  all.value='all'; all.textContent=state.mode==='amazon'?'Toda la Amazonía':'Toda Colombia';
  els.scopeSelect.appendChild(all);
  depCodes.sort((a,b)=>(depMap.get(a)||'').localeCompare(depMap.get(b)||'','es')).forEach(code=>{
    const opt=document.createElement('option'); opt.value=String(code); opt.textContent=depMap.get(code)||String(code); els.scopeSelect.appendChild(opt);
  });
  const exists=[...els.scopeSelect.options].some(o=>o.value===String(prior));
  state.scope=exists?String(prior):'all';
  els.scopeSelect.value=state.scope;
}

function resetGame(){
  clearRevealed();
  for(const m of state.markers.values()) if(map.hasLayer(m)) map.removeLayer(m);
  state.markers.clear();
  state.guessed.clear();
}

function startGame(mode){
  if(!state.data) return;
  resetGame();
  state.mode=mode; state.scope='all';
  els.modeTitle.textContent=mode==='amazon'?'Amazonía colombiana':'Colombia';
  els.resumeBtn.classList.add('hidden');
  setLanding(false); buildScopeOptions(); refreshAll();
  collapseMobileRank();
  if(mode==='amazon') fitCurrentScope(); else map.fitBounds([[-4.4,-79.1],[13.5,-66.7]],{padding:[25,25]});
  setTimeout(()=>{ els.guessInput.focus(); syncMobileViewport(); },80);
}

function refreshAll(){
  updateScores(); updateRankings(); refreshMarkerVisibility(); updateBoundaryStyles();
}
function updateScores(){
  const {guessed,totalPop,guessedPop}=populationStats();
  els.placeCount.textContent=fmtInt(guessed.length);
  els.populationCount.textContent=fmtInt(guessedPop);
  els.populationPct.textContent=totalPop?fmtPct(guessedPop/totalPop):'—';
}
function updateRankings(){
  const guessed=guessedInScope();
  const isolated=[...guessed].filter(p=>p.ar!==null && p.ar!==undefined).sort((a,b)=>a.ar-b.ar).slice(0,5);
  const least=[...guessed].filter(p=>p.p!==null && p.p!==undefined).sort((a,b)=>a.p-b.p || a.pr-b.pr).slice(0,5);
  renderRankList(els.isolatedList,isolated,'isolated');
  renderRankList(els.leastPopulatedList,least,'leastPopulation');
}
function renderRankList(el,list,type){
  if(!list.length){ el.className='rank-list empty-list'; el.innerHTML='<li>—</li>'; return; }
  el.className='rank-list';
  el.innerHTML=list.map((p,i)=>{
    const meta=type==='isolated'
      ? isolationLabel(p)
      : `${lowPopulationLabel(p)} (${fmtInt(p.p)} hab.)`;
    return `<li><span class="rank-num">${i+1}</span><span class="rank-name" title="${escapeHtml(p.n)}">${escapeHtml(shortName(p.n))}</span><span class="rank-meta">${escapeHtml(meta)}</span></li>`;
  }).join('');
}
function shortName(name){
  const first=String(name).split(',')[0].trim();
  return first.length>36?first.slice(0,34)+'…':first;
}

function acceptedPlaceNames(p){
  const names=new Set();
  const canonical=normalizeText(p.n);
  const short=normalizeText(String(p.n).split(',')[0]);
  if(canonical) names.add(canonical);
  if(short) names.add(short);
  for(const a of (p.a||[])){
    const na=normalizeText(a);
    if(na) names.add(na);
  }
  // Global aliases also work when followed by municipality/department,
  // e.g. PASTO NARINO -> SAN JUAN DE PASTO.
  for(const [alias,target] of QUERY_ALIASES){
    if(normalizeText(target)===canonical) names.add(normalizeText(alias));
  }
  return [...names];
}

function exactMatches(query){
  const nq=normalizeText(query); if(!nq) return [];
  return scopePlaces().filter(p=>{
    const names=acceptedPlaceNames(p);
    const municipality=normalizeText(p.mn);
    const department=normalizeText(p.dn);
    for(const name of names){
      // Plain place name.
      if(nq===name) return true;
      // Optional geographic qualifier. Commas are intentionally irrelevant
      // because normalizeText converts punctuation to spaces.
      if(municipality && nq===`${name} ${municipality}`) return true;
      if(department && nq===`${name} ${department}`) return true;
      if(municipality && department && nq===`${name} ${municipality} ${department}`) return true;
    }
    return false;
  });
}

function submitGuess(){
  const raw=els.guessInput.value.trim(); if(!raw) return;
  const matches=exactMatches(raw);
  if(!matches.length){ showToast('No encontré ese nombre en el ámbito seleccionado.'); return; }
  const remaining=matches.filter(p=>!state.guessed.has(p.id));
  if(!remaining.length){ showToast(matches.length===1?'Ese lugar ya estaba en tu mapa.':'Ya nombraste todos los lugares con ese nombre en este ámbito.'); els.guessInput.select(); return; }
  if(remaining.length===1){ addGuess(remaining[0]); return; }
  const withPop=remaining.filter(p=>p.p!==null && p.p!==undefined);
  if(withPop.length){
    const maxPop=Math.max(...withPop.map(p=>p.p));
    const largest=withPop.filter(p=>p.p===maxPop);
    if(largest.length===1){ addGuess(largest[0]); return; }
  }
  openHomonymPicker(raw,remaining);
}
function openHomonymPicker(raw,places){
  blurMobileKeyboard();
  els.homonymTitle.textContent=`¿Cuál “${raw}” querías decir?`;
  els.homonymChoices.innerHTML='';
  places.sort((a,b)=>a.dn.localeCompare(b.dn,'es')||a.mn.localeCompare(b.mn,'es')).forEach(p=>{
    const b=document.createElement('button'); b.className='choice-button';
    b.innerHTML=`<strong>${escapeHtml(shortName(p.n))}</strong><span>${escapeHtml(p.mn)} · ${escapeHtml(p.dn)}</span>`;
    b.addEventListener('click',()=>{ closeModal('homonymModal'); addGuess(p); });
    els.homonymChoices.appendChild(b);
  });
  els.homonymModal.classList.remove('hidden');
}
function addGuess(p){
  state.guessed.add(p.id); els.guessInput.value=''; addMarker(p,false); refreshAll();
  const signals=[];
  const isoTop=isolationTopPct(p);
  const lowTop=lowPopulationTopPct(p);
  if(isoTop!==null && isoTop<=10) signals.push(`Top ${fmtTopPct(isoTop)} más aislado`);
  if(lowTop!==null && lowTop<=10) signals.push(`Top ${fmtTopPct(lowTop)} menor población`);
  showToast(`${shortName(p.n)} — ${signals.length?signals.join(' · '):p.mn}`);
  map.panTo([p.y,p.x],{animate:true,duration:.45});
  setTimeout(()=>els.guessInput.focus(),50);
}
function popupHtml(p){
  const isoTop=isolationTopPct(p);
  const lowTop=lowPopulationTopPct(p);
  return `<div class="place-popup"><h3>${escapeHtml(shortName(p.n))}</h3><div class="where">${escapeHtml(p.mn)} · ${escapeHtml(p.dn)}</div><dl>`+
    `<dt>Población</dt><dd class="${p.p===null?'no-data':''}">${p.p===null?'sin dato censal':fmtInt(p.p)}</dd>`+
    `<dt>Menor población</dt><dd>${lowTop===null?'—':`Top ${fmtTopPct(lowTop)}`}</dd>`+
    `<dt>Aislamiento</dt><dd>${isoTop===null?'—':`Top ${fmtTopPct(isoTop)}`}</dd></dl></div>`;
}
function addMarker(p,revealed=false){
  const store=revealed?state.revealed:state.markers;
  if(store.has(p.id)) return store.get(p.id);
  const marker=L.circleMarker([p.y,p.x],{
    radius:6, weight:revealed?1:1.5, color:revealed?'rgba(255,255,255,.42)':'rgba(255,255,255,.88)',
    fillColor:populationColor(p.p), fillOpacity:revealed?.38:.92, opacity:revealed?.50:.95,
    className:revealed?'revealed-marker':''
  }).bindPopup(popupHtml(p),{maxWidth:310});
  marker.addTo(map); store.set(p.id,marker); return marker;
}
function refreshMarkerVisibility(){
  if(!state.data) return;
  const allowed=new Set(scopePlaces().map(p=>p.id));
  for(const [id,m] of state.markers){ if(allowed.has(id)){ if(!map.hasLayer(m))m.addTo(map); } else if(map.hasLayer(m))map.removeLayer(m); }
  for(const [id,m] of state.revealed){ if(allowed.has(id)){ if(!map.hasLayer(m))m.addTo(map); } else if(map.hasLayer(m))map.removeLayer(m); }
}
function clearRevealed(){ for(const m of state.revealed.values()) if(map.hasLayer(m)) map.removeLayer(m); state.revealed.clear(); }

function showToast(message){
  els.toast.textContent=message; els.toast.classList.remove('hidden'); clearTimeout(state.toastTimer);
  state.toastTimer=setTimeout(()=>els.toast.classList.add('hidden'),3000);
}
function closeModal(id){ $(id).classList.add('hidden'); if(id!=='homonymModal') setTimeout(()=>els.guessInput.focus(),30); }

function foundSortLabel(sort){
  if(sort==='populationAsc') return 'menor → mayor población';
  if(sort==='isolation') return 'más → menos aislado';
  return 'mayor → menor población';
}
function sortedFoundPlaces(guessed,sort){
  const list=[...guessed];
  if(sort==='populationAsc') return list.sort((a,b)=>{
    const ap=a.p===null||a.p===undefined?Infinity:Number(a.p);
    const bp=b.p===null||b.p===undefined?Infinity:Number(b.p);
    return ap-bp || (Number(b.pr)||0)-(Number(a.pr)||0) || a.n.localeCompare(b.n,'es');
  });
  if(sort==='isolation') return list.sort((a,b)=>{
    const arA=a.ar===null||a.ar===undefined?Infinity:Number(a.ar);
    const arB=b.ar===null||b.ar===undefined?Infinity:Number(b.ar);
    return arA-arB || a.n.localeCompare(b.n,'es');
  });
  return list.sort((a,b)=>{
    const ap=a.p===null||a.p===undefined?-Infinity:Number(a.p);
    const bp=b.p===null||b.p===undefined?-Infinity:Number(b.p);
    return bp-ap || a.n.localeCompare(b.n,'es');
  });
}
function foundMetricHtml(p,sort){
  const iso=isolationTopPct(p), low=lowPopulationTopPct(p);
  if(sort==='isolation') {
    if(iso===null) return '<div class="found-pop"><strong>—</strong><small>sin dato de aislamiento</small></div>';
    const rank=Number.isFinite(Number(p.ar))?`#${fmtInt(Number(p.ar))} nacional`:'';
    return `<div class="found-pop"><strong>Top ${fmtTopPct(iso)}</strong><small>${escapeHtml(rank)}</small></div>`;
  }
  if(p.p===null || p.p===undefined) return '<div class="found-pop"><strong>—</strong><small>sin dato censal</small></div>';
  const small=sort==='populationAsc' && low!==null ? `Top ${fmtTopPct(low)} menor pob.` : 'habitantes';
  return `<div class="found-pop"><strong>${fmtInt(p.p)}</strong><small>${escapeHtml(small)}</small></div>`;
}
function foundBadgesHtml(p,sort){
  const iso=isolationTopPct(p), low=lowPopulationTopPct(p);
  const bits=[];
  if(sort==='isolation'){
    if(p.p!==null && p.p!==undefined) bits.push(`<span>${fmtInt(p.p)} hab.</span>`);
    if(low!==null && low<=10) bits.push(`<span title="Top nacional entre los de menor población">Top ${fmtTopPct(low)} menor pob.</span>`);
  } else {
    if(iso!==null && iso<=10) bits.push(`<span title="Top nacional de aislamiento">Top ${fmtTopPct(iso)} aisl.</span>`);
    if(sort!=='populationAsc' && low!==null && low<=10) bits.push(`<span title="Top nacional entre los de menor población">Top ${fmtTopPct(low)} menor pob.</span>`);
  }
  return bits.join('');
}
function renderFoundPlaces(){
  const {guessed,guessedPop,totalPop}=populationStats();
  const sort=state.foundSort;
  const sorted=sortedFoundPlaces(guessed,sort);
  document.querySelectorAll('[data-found-sort]').forEach(b=>{
    if(b.classList.contains('found-tab')) b.classList.toggle('active',b.dataset.foundSort===sort);
  });
  els.foundPlacesMeta.innerHTML=`<strong>${fmtInt(guessed.length)}</strong> lugares · <strong>${fmtInt(guessedPop)}</strong> personas · <strong>${totalPop?fmtPct(guessedPop/totalPop):'—'}</strong> de la población · orden: <strong>${foundSortLabel(sort)}</strong>`;
  els.foundPlacesList.innerHTML=sorted.length?sorted.map((p,i)=>`<div class="found-row">
      <span class="found-index">${i+1}</span>
      <div class="found-place"><strong>${escapeHtml(shortName(p.n))}</strong><small>${escapeHtml(p.mn)} · ${escapeHtml(p.dn)}</small></div>
      ${foundMetricHtml(p,sort)}
      <div class="found-badges">${foundBadgesHtml(p,sort)}</div>
    </div>`).join(''):'<p class="found-empty">Todavía no has nombrado ningún lugar.</p>';
}
function openFoundPlaces(sort='populationDesc'){
  blurMobileKeyboard();
  state.foundSort=sort;
  renderFoundPlaces();
  els.foundPlacesModal.classList.remove('hidden');
}

function openSummary(){
  blurMobileKeyboard();
  const {guessed,totalPop,guessedPop}=populationStats();
  els.summaryTitle.textContent=state.mode==='amazon'?'Tu mapa de la Amazonía':'Tu mapa de Colombia';
  els.summaryPlaces.textContent=fmtInt(guessed.length);
  els.summaryPopulation.textContent=fmtInt(guessedPop);
  els.summaryPop.textContent=totalPop?fmtPct(guessedPop/totalPop):'—';
  const iso=[...guessed].filter(p=>p.ar!==null && p.ar!==undefined).sort((a,b)=>a.ar-b.ar).slice(0,10);
  const least=[...guessed].filter(p=>p.p!==null && p.p!==undefined).sort((a,b)=>a.p-b.p || a.pr-b.pr).slice(0,10);
  renderSummary(els.summaryIsolated,iso,p=>`${isolationLabel(p)} más aislado`);
  renderSummary(els.summaryLeastPopulated,least,p=>`${lowPopulationLabel(p)} · ${fmtInt(p.p)} hab.`);
  els.summaryModal.classList.remove('hidden');
}
function renderSummary(el,list,meta){ el.innerHTML=list.length?list.map(p=>`<li><span>${escapeHtml(shortName(p.n))}</span><small>${escapeHtml(meta(p))}</small></li>`).join(''):'<li><span>—</span></li>'; }
function revealAnswers(){
  closeModal('summaryModal'); clearRevealed();
  scopePlaces().filter(p=>!state.guessed.has(p.id)).forEach(p=>addMarker(p,true));
  showToast('Respuestas visibles. Tus lugares permanecen resaltados.');
}

function fitCurrentScope(){
  const points=scopePlaces();
  if(state.mode==='amazon' && state.scope==='all' && state.amazonLayer){ map.fitBounds(state.amazonLayer.getBounds(),{padding:[25,25]}); return; }
  if(state.scope!=='all' && state.departmentLayer){
    let found=null; state.departmentLayer.eachLayer(l=>{ if(Number(l.feature?.properties?.DPTO_CCDGO)===Number(state.scope)) found=l; });
    if(found){ map.fitBounds(found.getBounds(),{padding:[25,25]}); return; }
  }
  if(points.length){ const bounds=L.latLngBounds(points.map(p=>[p.y,p.x])); map.fitBounds(bounds.pad(.12),{maxZoom:9}); }
}

function updateBoundaryStyles(){
  if(state.departmentLayer){
    state.departmentLayer.setStyle(f=>{
      const selected=state.scope!=='all' && Number(f.properties?.DPTO_CCDGO)===Number(state.scope);
      const amazonMode=state.mode==='amazon';
      return {color:selected?'rgba(225,248,232,.92)':'rgba(255,255,255,.34)',weight:selected?1.8:.7,fillColor:'#d7f2df',fillOpacity:selected?.035:0,opacity:amazonMode?.40:.62};
    });
  }
  if(state.amazonLayer){
    const show=state.mode==='amazon';
    state.amazonLayer.setStyle({color:show?'rgba(208,245,219,.92)':'rgba(208,245,219,0)',weight:show?1.6:0,fillOpacity:0});
  }
}

async function loadDepartmentBoundaries(){
  try{
    const res=await fetch(DEPARTMENT_BOUNDARY_URL); if(!res.ok) throw new Error('DANE');
    state.departmentGeoJSON=await res.json();
    state.departmentLayer=L.geoJSON(state.departmentGeoJSON,{interactive:false}).addTo(map); updateBoundaryStyles();
  }catch(e){ console.info('Límites departamentales no disponibles; el juego continúa sin esta capa.'); }
}
async function loadAmazonBoundary(){
  try{
    const res=await fetch(AMAZON_BOUNDARY_URL); if(!res.ok) throw new Error('SINCHI');
    const geo=await res.json(); state.amazonBoundary=geo;
    state.amazonIds=new Set(state.data.places.filter(p=>pointInFeatureCollection([p.x,p.y],geo)).map(p=>p.id));
    state.amazonLayer=L.geoJSON(geo,{interactive:false,style:{fillOpacity:0}}).addTo(map);
    if(state.mode==='amazon'){ buildScopeOptions(); refreshAll(); fitCurrentScope(); }
  }catch(e){ console.info('Se usa la clasificación amazónica de respaldo por entidades SIAT-AC.'); }
}

els.submitGuess.addEventListener('click',submitGuess);
els.guessInput.addEventListener('keydown',e=>{ if(e.key==='Enter') submitGuess(); if(e.key==='Escape') els.guessInput.value=''; });
els.scopeSelect.addEventListener('change',()=>{ state.scope=els.scopeSelect.value; clearRevealed(); refreshAll(); fitCurrentScope(); els.guessInput.focus(); });
els.collapseRank.addEventListener('click',()=>{ els.rankPanel.classList.add('hidden'); els.openRank.classList.remove('hidden'); });
els.openRank.addEventListener('click',()=>{ blurMobileKeyboard(); els.openRank.classList.add('hidden'); els.rankPanel.classList.remove('hidden'); });
els.foundPlacesBtn.addEventListener('click',()=>openFoundPlaces('isolation'));
document.querySelectorAll('[data-found-sort]').forEach(b=>b.addEventListener('click',()=>openFoundPlaces(b.dataset.foundSort)));
els.finishBtn.addEventListener('click',openSummary);
els.continueBtn.addEventListener('click',()=>closeModal('summaryModal'));
els.revealBtn.addEventListener('click',revealAnswers);
els.homeBtn.addEventListener('click',()=>{
  blurMobileKeyboard();
  closeModal('summaryModal'); closeModal('homonymModal'); closeModal('foundPlacesModal'); clearRevealed();
  document.body.classList.remove('keyboard-open');
  els.resumeBtn.classList.toggle('hidden',!state.mode);
  setLanding(true); map.fitBounds([[-4.4,-79.1],[13.5,-66.7]],{padding:[20,20]}); updateBoundaryStyles();
});
els.resumeBtn.addEventListener('click',()=>{
  if(!state.mode) return;
  setLanding(false); refreshAll(); fitCurrentScope(); collapseMobileRank();
  setTimeout(()=>{ els.guessInput.focus(); syncMobileViewport(); },50);
});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>startGame(b.dataset.mode)));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
[els.homonymModal,els.foundPlacesModal,els.summaryModal].forEach(m=>m.addEventListener('click',e=>{ if(e.target===m) closeModal(m.id); }));

(async function init(){
  try{
    const res=await fetch(DATA_URL); if(!res.ok) throw new Error(`Datos ${res.status}`); state.data=await res.json();
    buildPopulationPercentiles();
    document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=false);
    await Promise.allSettled([loadDepartmentBoundaries(),loadAmazonBoundary()]);
  }catch(err){
    console.error(err);
    document.querySelector('.landing-note').textContent='No fue posible cargar la base del juego. Revisa que el sitio se esté sirviendo por HTTP/HTTPS.';
    document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=true);
  }
})();
