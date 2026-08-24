# CLAUDE.md

Guía para trabajar en este repositorio.

## Qué es esto

Formulario público para reportar, sede por sede, las acciones que se van a
ejecutar de manera inmediata en instituciones educativas rurales de Caldas,
Risaralda, Quindío y el Valle del Cauca. Basado en los campos pedidos en
`BASE DE DATOS EN LÍNEA.docx`.

El panel de administración (vista por departamento, edición de registros)
**todavía no está construido** — por ahora solo existe el formulario de
captura. Ver el plan completo en `C:\Users\alejo\.claude\plans\hola-chat-necesito-generar-idempotent-hoare.md`
si se retoma esa parte.

## Arquitectura

Sitio estático sin build ni dependencias (igual que el resto de proyectos
GAS del usuario). Abre [index.html](index.html) directo en el navegador, o
sírvelo con `npx serve .`.

```
index.html + css/{tokens,formulario}.css + js/{texto,catalogo,config,formulario}.js
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
  mismo departamento en un solo envío), selects con opción "No está en la
  lista" que revela un campo de texto, chips de afectación y de acciones
  sugeridas, borrador en `localStorage`, "Mis reportes guardados"
  (recuperar/editar lo ya enviado) y envío secuencial sede por sede con
  reintento de las que fallen.
- [gas/Code.gs](gas/Code.gs) — backend. `inicializar()` crea el spreadsheet
  (una vez) dentro de la carpeta de Drive del proyecto y siembra la pestaña
  `registros`.

**Contrato del backend** (mismo patrón `{ ok, data | error }` que el resto
de proyectos GAS del usuario):

| Método | `accion` | Devuelve |
|---|---|---|
| GET | `reportantes` | nombre/correo/teléfono/departamento más recientes por reportante — autocompletar |
| GET | `misRegistros&reportante=Nombre` | sedes ya guardadas (Borrador o Completo) por ese reportante |
| POST | `guardarRegistro` | upsert por clave natural `Departamento\|Municipio\|Institución\|Sede` |
| POST | `eliminarRegistro` | borra por `id`, solo si pertenece al mismo reportante |

El `POST` siempre usa `Content-Type: text/plain` con body `JSON.stringify(...)`
— intencional, evita el preflight CORS que Apps Script no maneja. **No
cambiarlo a `application/json`.**

## Esquema de "registros"

`id · Marca temporal · Actualizado · Reportante · Correo reportante ·
Teléfono reportante · Departamento · Municipio · Vereda · Institución ·
Sede · Rector · Correo rector · Teléfono rector · Número de estudiantes ·
Tipos de afectación (JSON) · Descripción de afectaciones · Acciones
sugeridas (JSON) · Acciones inmediatas · Estado`

`Estado` es `Borrador` (sede guardada sin rector/estudiantes/afectaciones/
descripción/acciones/acciones sugeridas) o `Completo`. La vereda se pide
por sede, no por institución — una misma institución puede tener sedes en
veredas distintas. Los teléfonos (`Teléfono reportante`, `Teléfono rector`)
se guardan forzados a texto (`comoTexto_` en `gas/Code.gs`, prefijo de
comilla simple) — sin eso Sheets los convierte a número y arriesga perder
ceros a la izquierda.

"Acciones sugeridas" son chips de selección múltiple (checklist de
acciones típicas post-sismo: inmediatas, corto plazo, mediano plazo,
definidas en `index.html` dentro de `#tpl-sede`); "Acciones inmediatas" es
el campo de texto libre para el detalle adicional que no cubran los chips.

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
