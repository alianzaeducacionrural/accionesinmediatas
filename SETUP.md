# SETUP — Acciones inmediatas por departamento

El código ya está escrito y el proyecto de Apps Script ya existe (creado con
`clasp create`, código subido con `clasp push`). Quedan 3 pasos manuales que
ninguna CLI puede automatizar — son la pared de seguridad de Google, no de
`clasp`.

Script: https://script.google.com/d/1_msT7W0RxO8RSPuaZ6InK82CyoCRrgkQak-OuEWdWB6dIoTaaVi0RIa_/edit

## 1. Autorizar permisos y crear el spreadsheet

1. Abre el script con el enlace de arriba (o `cd gas && clasp open`).
2. En el menú de funciones (arriba, junto a "Depurar"), elige **`inicializar`** y pulsa **Ejecutar**.
3. La primera vez Google pedirá autorizar permisos (Hojas de cálculo y Drive)
   — es tu cuenta `edurural.osorio.alejandro@gmail.com`, la misma que ya usan
   los demás proyectos. Acepta.
4. Vuelve a ejecutar `inicializar` después de autorizar (la primera corrida
   se interrumpe en el paso de permisos).
5. Abre **Ver → Registros** (o `Ctrl+Enter`) y copia el ID que aparece en el
   log: `Spreadsheet creado en la carpeta de Drive indicada. Copia este ID a
   RESULTS_SHEET_ID en Code.gs: <ID>`.
6. Pega ese ID en [gas/Code.gs](gas/Code.gs), en la constante `RESULTS_SHEET_ID`
   (línea ~20), y vuelve a subirlo:
   ```bash
   cd gas
   clasp push --force
   ```

El spreadsheet queda dentro de la carpeta de Drive indicada:
https://drive.google.com/drive/folders/1cG8pP4XexZ66pnYQn29PrazjIbXFOqdD

## 2. Desplegar como Web App

1. En el editor: **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**.
4. Implementar, y copia la URL `/exec` que entrega Google.
5. Pégala en [js/config.js](js/config.js), en `CONFIG.GAS_URL`.

Cada vez que cambies `Code.gs` después de esto: `clasp push --force` y luego
**Implementar → Gestionar implementaciones → editar (lápiz) → Nueva
versión → Implementar** (mantiene la misma URL `/exec`, no crear una
implementación nueva).

## 3. Probar el formulario

Sitio estático sin build. Desde la carpeta del proyecto:

```bash
npx serve .
```

o abre [index.html](index.html) directo en el navegador. Llena un reporte de
Caldas (para probar la cascada de catálogo) y uno de otro departamento (para
probar los campos de texto libre), y confirma que las filas aparecen en la
pestaña "registros" del spreadsheet con los nombres en formato Nombre Propio.

## Publicar el sitio

Este formulario todavía no está en un repositorio ni tiene hosting público.
Cuando quieras publicarlo (GitHub Pages, Vercel u otro), dímelo y lo dejamos
desplegado — falta decidir dónde.
