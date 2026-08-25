# CLAUDE.md

Guía para trabajar en este repositorio.

## Qué es esto

Formulario público para reportar, sede por sede, las acciones que se van a
ejecutar de manera inmediata en instituciones educativas rurales de Caldas,
Risaralda, Quindío y el Valle del Cauca. Basado en los campos pedidos en
`BASE DE DATOS EN LÍNEA.docx`.

También existe [dashboard.html](dashboard.html): panel de control con
consolidado de los 4 departamentos y enlaces filtrados por departamento
(`?departamento=Caldas`), con edición y eliminación de registros. Sin login,
URL no enlazada desde `index.html`.

## Arquitectura

Sitio estático sin build ni dependencias (igual que el resto de proyectos
GAS del usuario). Abre [index.html](index.html) directo en el navegador, o
sírvelo con `npx serve .`.

```
index.html    + css/{tokens,formulario}.css + js/{texto,catalogo,config,formulario}.js
dashboard.html + css/{tokens,formulario,dashboard}.css + js/{texto,catalogo,config,dashboard}.js
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
  vez en el formulario.
- [gas/Code.gs](gas/Code.gs) — backend. `inicializar()` crea el spreadsheet
  (una vez) dentro de la carpeta de Drive del proyecto y siembra la pestaña
  `registros`. `normalizarCamposRegistro_()` centraliza la normalización y
  validación de campos, reusada por `guardarRegistro_` (upsert, formulario
  público) y `editarRegistro_` (por `id`, dashboard).
- [dashboard.html](dashboard.html) + [js/dashboard.js](js/dashboard.js) +
  [css/dashboard.css](css/dashboard.css) — panel de control, sin pasos ni
  login. `dashboard.html` (sin parámetro) muestra el consolidado de los 4
  departamentos; `dashboard.html?departamento=Caldas` (o Risaralda, Quindío,
  `Valle del Cauca`) muestra solo ese departamento — el filtro se resuelve
  en el propio backend (`todosLosRegistros_`), no solo en el cliente, para
  que un enlace filtrado nunca haga viajar por la red los datos de los
  otros departamentos (ver la nota de seguridad al inicio de `cargarDatos()`
  en `js/dashboard.js`). Pestañas para cambiar de departamento (actualizan
  la URL); solo entrar o volver a "Todos" dispara el fetch consolidado —
  cambiar a un departamento específico sin haberlo cargado ya pide un fetch
  nuevo acotado a ese departamento. KPIs, gráficos de barras caseros (sin
  librerías, mismo patrón que `Encuesta Daños por sismo/dashboard.html`) y
  una tabla ordenable/filtrable. Cada fila abre un panel lateral de detalle
  con botones Editar (formulario clonado de `<template id="tpl-editor-sede">`,
  reusa `.chip`/`.campo`/`.control`/`.stepper`/`.badge-estado` de
  `formulario.css` y `nombrePropio()` para la vista previa) y Eliminar
  (confirmación de dos clics). A diferencia del formulario público,
  municipio/institución/sede se editan como texto libre (sin la cascada de
  catálogo de Caldas) porque quien edita ya tiene datos reales que corregir.

**Contrato del backend** (mismo patrón `{ ok, data | error }` que el resto
de proyectos GAS del usuario):

| Método | `accion` | Devuelve |
|---|---|---|
| GET | `reportantes` | nombre/correo/teléfono/departamento más recientes por reportante — autocompletar |
| GET | `misRegistros&reportante=Nombre` | sedes ya guardadas (Borrador o Completo) por ese reportante |
| GET | `todosLosRegistros[&departamento=]` | todas las filas, o solo las de un departamento — lo consume `dashboard.html` |
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
sugeridas (JSON) · Aporte del departamento (JSON) · Estado`

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

`Estado` es `Borrador` (sede guardada sin rector/estudiantes/afectaciones/
descripción/acciones sugeridas) o `Completo`. La vereda se pide por sede,
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
