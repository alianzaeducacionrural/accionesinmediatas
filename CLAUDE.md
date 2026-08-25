# CLAUDE.md

Guía para trabajar en este repositorio.

## Qué es esto

Formulario público para reportar, sede por sede, las acciones que se van a
ejecutar de manera inmediata en instituciones educativas rurales de Caldas,
Risaralda, Quindío y el Valle del Cauca. Basado en los campos pedidos en
`BASE DE DATOS EN LÍNEA.docx`.

También existe el dashboard: [dashboard.html](dashboard.html) (consolidado,
para el equipo central) + 4 páginas dedicadas, una por departamento
(`dashboard-caldas.html`, `dashboard-risaralda.html`, `dashboard-quindio.html`,
`dashboard-valle-del-cauca.html`), cada una con su propio token en la URL
(`?t=...`) para que no sea trivial cambiarle el nombre al departamento y ver
los datos de otro. Con edición y eliminación de registros. Sin login, URLs
no enlazadas desde `index.html`.

## Arquitectura

Sitio estático sin build ni dependencias (igual que el resto de proyectos
GAS del usuario). Abre [index.html](index.html) directo en el navegador, o
sírvelo con `npx serve .`.

```
index.html                       + css/{tokens,formulario}.css + js/{texto,catalogo,config,formulario}.js
dashboard.html                   + js/dashboard-tokens.js  ┐
dashboard-caldas.html             (departamento fijo)       ├─ css/{tokens,formulario,dashboard}.css
dashboard-risaralda.html          (departamento fijo)        │  js/{texto,catalogo,config,dashboard}.js
dashboard-quindio.html            (departamento fijo)        │
dashboard-valle-del-cauca.html    (departamento fijo)       ┘
                    ↓ fetch (GET/POST, Content-Type: text/plain)
gas/Code.gs   (Apps Script standalone, desplegado como Web App)
                    ↓
Google Sheets "Acciones inmediatas por departamento — Registro" (pestaña "registros")
```

**Archivos**
- [js/texto.js](js/texto.js) — `nombrePropio()`, normaliza a "Nombre Propio"
  con conectores en minúscula (`San Juan de Dios`). Duplicada en
  `gas/Code.gs` (`nombrePropio_`) porque el backend es la última línea de
  defensa: nada entra al Sheet sin pasar por ella.
- [js/catalogo.js](js/catalogo.js) — **generado, no editar a mano**. Árbol
  Municipio → Institución → [Sedes] de Caldas (27/111/806, cero huérfanos) +
  listas de municipios de Risaralda/Quindío/Valle (sin catálogo de
  instituciones/sedes: se escriben a mano en el formulario). Se regenera con
  `node tools/generar-catalogo.mjs` si cambia el catálogo de Caldas en
  `Plataformas/La Universidad en el Campo/*.csv`.
- [js/formulario.js](js/formulario.js) — formulario de una sola página (sin
  pasos ni navegación: reportante e instituciones/sedes están siempre
  visibles, un único botón "Enviar registros" valida todo de una vez).
  Repetidores con `<template>` + clonado de nodos, cada institución con su
  propio selector de municipio (para poder mezclar varios municipios del
  mismo departamento en un solo envío) y su propio rector (nombre, teléfono,
  correo — dato general de la institución y de todas sus sedes, no se repite
  por sede), selects con opción "No está en la lista" que revela un campo de
  texto, chips de afectación y de acciones sugeridas, borrador en
  `localStorage`, "Mis reportes guardados" (recuperar/editar lo ya enviado)
  y envío secuencial sede por sede con reintento de las que fallen. Al
  enviar, cada sede hereda el rector de su institución (`enviarTodo`) — la
  fila del Sheet sigue siendo una por sede, el rector solo se captura una
  vez en el formulario. Al escribir una institución (departamento +
  municipio + nombre) que ya tenga rector guardado de un envío anterior de
  cualquier reportante, `intentarAutocompletarRector()` lo completa
  automáticamente — solo si los 3 campos de rector están vacíos, para no
  pisar lo ya escrito; los datos vienen de `accion=rectoresConocidos`,
  cargados una vez al iniciar (`cargarRectoresConocidos()`). Lo mismo pasa
  con el nombre del reportante: si ya reportó antes, `intentarAutocompletarReportante()`
  completa su correo/teléfono desde `accion=reportantes` (solo si ambos
  campos están vacíos). El `<datalist>` de nombres conocidos se puebla con
  `appendChild` — `datalist.add()` no existe (ese método es de `<select>`).
- [gas/Code.gs](gas/Code.gs) — backend. `inicializar()` crea el spreadsheet
  (una vez) dentro de la carpeta de Drive del proyecto y siembra la pestaña
  `registros`. `normalizarCamposRegistro_()` centraliza la normalización y
  validación de campos, reusada por `guardarRegistro_` (upsert, formulario
  público) y `editarRegistro_` (por `id`, dashboard).
- **Dashboard** — [js/dashboard.js](js/dashboard.js) + [css/dashboard.css](css/dashboard.css),
  compartidos por 5 páginas HTML, sin pasos ni login:
  - [dashboard.html](dashboard.html) — vista consolidada de los 4
    departamentos, para el equipo central. Pestañas para cambiar de
    departamento (filtran en memoria una vez cargado "Todos" — solo la
    carga inicial pide red). Es la única página que carga
    [js/dashboard-tokens.js](js/dashboard-tokens.js) (el mapa
    `TOKENS_DEPARTAMENTO`), y lo usa para armar la tarjeta "Enlaces por
    departamento" (`renderEnlacesDepartamento()`): 4 enlaces a las páginas
    dedicadas de abajo, cada uno con su token, listos para compartir con el
    equipo regional (botón "Copiar enlace", Clipboard API).
  - `dashboard-caldas.html` / `dashboard-risaralda.html` /
    `dashboard-quindio.html` / `dashboard-valle-del-cauca.html` — una
    página HTML por departamento, casi idénticas a `dashboard.html` salvo
    un `<script>` inline al final (`window.DASHBOARD_FIJO = { departamento: 'Caldas' }`,
    etc. — se generaron una vez con un script de un solo uso a partir de
    `dashboard.html`, no hay que mantenerlas manualmente en sincronía salvo
    que cambie la plantilla). Sin pestañas (se ocultan solas: `iniciar()`
    detecta `window.DASHBOARD_FIJO`), sin la tarjeta de enlaces (no aplica).
    El token se lee de `?t=` en la URL, nunca queda escrito en el archivo —
    y como estas 4 páginas **no cargan `js/dashboard-tokens.js`**, su
    código fuente nunca expone los tokens de los otros 3 departamentos.
  - **Backend**: `todosLosRegistros_` sigue filtrando por departamento en
    el propio servidor (no solo en el cliente), pero además `doGet` en
    `gas/Code.gs` exige que `token` coincida con `TOKENS_DEPARTAMENTO[departamento]`
    cuando se pide un departamento puntual — sin eso, cambiar
    `?departamento=` a mano ya no alcanza (ni siquiera aplica: estas
    páginas no leen ese parámetro de la URL, el departamento es fijo por
    archivo). **Esto es una barrera de obscuridad, no autenticación real**
    — el token viaja en la URL y, para el equipo central, en el JS de
    `dashboard.html`. La consolidada (`accion=todosLosRegistros` sin
    `departamento`) nunca pide token, mismo modelo de siempre ("sin login,
    URL no enlazada"). Si un token se filtra, hay que generar uno nuevo y
    actualizarlo en dos sitios: `TOKENS_DEPARTAMENTO` en `gas/Code.gs` y en
    `js/dashboard-tokens.js` (desplegar el backend con `clasp push --force`
    + `clasp update-deployment`, y avisar al equipo del enlace nuevo).
  - **KPIs** (municipios · instituciones · sedes · estudiantes por atender
    — sin "estado", ver más abajo), gráficos de barras caseros (sin
    librerías, mismo patrón que `Encuesta Daños por sismo/dashboard.html`)
    y una tabla ordenable/filtrable donde cada fila termina en un botón
    "Ver más" muy visible. Clic en la fila o en el botón abre un **modal
    centrado y grande** (no un panel lateral) con el detalle completo, y
    desde ahí Editar (formulario clonado de `<template id="tpl-editor-sede">`,
    reusa `.chip`/`.campo`/`.control`/`.stepper` de `formulario.css` y
    `nombrePropio()` para la vista previa) o Eliminar (confirmación de dos
    clics). A diferencia del formulario público, municipio/institución/sede
    se editan como texto libre (sin la cascada de catálogo de Caldas)
    porque quien edita ya tiene datos reales que corregir. "Aporte del
    departamento" **no** se grafica como barras (es un campo global por
    envío, no por sede — contarlo por fila sobrestimaría el aporte real):
    se muestra como etiquetas de presencia/ausencia por departamento
    (`renderAporteDepartamento()`). Botón "Descargar Excel"
    (`descargarCsv()`) exporta un CSV con BOM UTF-8 de lo que esté
    filtrado en pantalla — en una página de departamento fijo, solo puede
    exportar ese departamento.

**Contrato del backend** (mismo patrón `{ ok, data | error }` que el resto
de proyectos GAS del usuario):

| Método | `accion` | Devuelve |
|---|---|---|
| GET | `reportantes` | nombre/correo/teléfono/departamento más recientes por reportante — autocompletar |
| GET | `misRegistros&reportante=Nombre` | sedes ya guardadas por ese reportante |
| GET | `todosLosRegistros[&departamento=&token=]` | todas las filas, o solo las de un departamento (exige `token` correcto — `TOKENS_DEPARTAMENTO` en `gas/Code.gs`) — lo consumen las 5 páginas del dashboard |
| GET | `rectoresConocidos` | último rector (nombre/correo/teléfono) por institución ya diligenciada — autocompletar |
| POST | `guardarRegistro` | upsert por clave natural `Departamento\|Municipio\|Institución\|Sede` |
| POST | `editarRegistro` | actualiza por `id`, sin restricción de reportante (panel sin sesión) |
| POST | `eliminarRegistro` | borra por `id`, sin restricción de reportante |

El `POST` siempre usa `Content-Type: text/plain` con body `JSON.stringify(...)`
— intencional, evita el preflight CORS que Apps Script no maneja. **No
cambiarlo a `application/json`.**

## Esquema de "registros"

`id · Marca temporal · Actualizado · Reportante · Correo reportante ·
Teléfono reportante · Departamento · Municipio · Vereda · Institución ·
Sede · Rector · Correo rector · Teléfono rector · Número de estudiantes ·
Tipos de afectación (JSON) · Descripción de afectaciones · Acciones
sugeridas (JSON) · Aporte del departamento (JSON)`

No hay columna de estado (Borrador/Completo): se quitó porque todos los
envíos llegan como reportes ya completados, la distinción no aportaba
nada. Era la última columna, así que quitarla no corrió el resto — se
borró físicamente del Sheet real con una migración de un solo uso (ya no
está en el código; si hace falta repetir el patrón, ver el historial de
`gas/Code.gs`).

`Rector`/`Correo rector`/`Teléfono rector` se capturan una sola vez por
institución en el formulario, pero se guardan repetidos en cada fila de
sede — el Sheet sigue siendo una fila por sede (no hay una pestaña aparte
de instituciones); ver `enviarTodo()` en `js/formulario.js`, que copia el
rector de la institución a cada `item` antes de enviarlo. `Aporte del
departamento` sigue el mismo patrón pero a nivel de **todo el envío**: es
un único grupo de chips al final del formulario (`Especie`/`Capacidad`/
`Recurso económico`, clase `.chip-aporte-departamento` en `index.html`),
fuera de `#listaInstituciones` — `enviarTodo()` lo calcula una vez
(`recopilarAporteDepartamento()`) y lo copia igual a cada `item`.

La vereda se pide por sede,
no por institución — una misma institución puede tener sedes en veredas
distintas. Los teléfonos (`Teléfono reportante`, `Teléfono rector`) se
guardan forzados a texto (`comoTexto_` en `gas/Code.gs`, prefijo de
comilla simple) — sin eso Sheets los convierte a número y arriesga perder
ceros a la izquierda.

"Acciones sugeridas" son chips de selección múltiple (checklist de
acciones inmediatas típicas post-sismo, definidas en `index.html` dentro
de `#tpl-sede`) con un chip "Otra" que revela un textarea de texto libre
(`accionesSugeridasDe()` en `js/formulario.js` sustituye el data-valor
literal "Otra" por lo escrito).

## Despliegue del backend — usa `clasp`, no copiar/pegar

Proyecto vinculado vía `gas/.clasp.json` (cuenta
`edurural.osorio.alejandro@gmail.com`, ya logueada). Ver
[SETUP.md](SETUP.md) para el detalle completo, incluidos los pasos
manuales (autorización de permisos y creación del spreadsheet) que ninguna
CLI puede automatizar.

## Convenciones

- Español, kebab-case en CSS, nombres de función descriptivos en español.
- Sin frameworks, sin build. `<template>` + clonado de nodos para los
  repetidores.
- Paleta propia (índigo + ámbar), distinta a la terracota de
  `Encuesta Daños por sismo` y al verde del resto del programa, a propósito.
