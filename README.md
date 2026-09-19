# Poblados — Colombia

Juego web estático para GitHub Pages.

## Versión integrada con `centros_v4`

- 7.549 centros poblados.
- Aislamiento v4: tiempo mínimo a cabecera + tiempo mínimo a capital departamental, con respaldo euclidiano penalizado cuando hay NoData.
- El mapa revela únicamente los lugares acertados.
- Símbolos de tamaño constante y color por población.
- Panel principal con énfasis en **más aislados** y **menor población**, expresados como Top % nacional con decimales.
- Lista secundaria no invasiva de todos los lugares encontrados, ordenados de mayor a menor población.
- Conteo visible de lugares, personas alcanzadas y porcentaje de población cubierta.
- Botón explícito `← Inicio` para volver rápidamente a la pantalla inicial.

Para probar localmente, sirve esta carpeta por HTTP (por ejemplo, `python -m http.server 8000`) y abre el navegador en el puerto correspondiente.


### v2_v4_1
El buscador acepta desambiguación por municipio o departamento, con o sin coma (p. ej. `SAN FELIPE GUAINIA`, `JOSÉ MARÍA, PUERTO GUZMÁN`).
