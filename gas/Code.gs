/**
 * ============================================================
 * Acciones inmediatas por departamento — Caldas, Risaralda, Quindío,
 * Valle del Cauca
 * Backend Google Apps Script (standalone, no vinculado a un Sheet)
 * ============================================================
 * Desplegar como Web App:
 *   Implementar → Nueva implementación → Aplicación web
 *   Ejecutar como: Yo (tu cuenta de Google)
 *   Quién tiene acceso: Cualquier usuario
 * Copiar la URL /exec resultante a js/config.js como GAS_URL.
 *
 * Antes de usar el formulario, ejecutar UNA vez inicializar() desde este
 * editor (menú de funciones → inicializar → Ejecutar). Si RESULTS_SHEET_ID
 * está vacío, inicializar() crea el spreadsheet y deja su ID en el Logger
 * — cópialo aquí para que quede fijo. Ver SETUP.md para el detalle.
 * ============================================================
 */

// ─── Configuración ──────────────────────────────────────────

// ID del spreadsheet de resultados. Vacío la primera vez: inicializar() lo
// crea dentro de CARPETA_DRIVE_ID y muestra el ID en el Logger para que lo
// pegues aquí.
var RESULTS_SHEET_ID = '';

// Carpeta de Drive donde debe quedar el spreadsheet y cualquier archivo
// asociado a esta plataforma — indicada por el usuario.
// https://drive.google.com/drive/folders/1cG8pP4XexZ66pnYQn29PrazjIbXFOqdD
var CARPETA_DRIVE_ID = '1cG8pP4XexZ66pnYQn29PrazjIbXFOqdD';

var HEADERS_REGISTROS = [
  'id', 'Marca temporal', 'Actualizado',
  'Reportante', 'Correo reportante', 'Teléfono reportante',
  'Departamento', 'Municipio', 'Vereda', 'Institución', 'Sede', 'Rector',
  'Número de estudiantes', 'Tipos de afectación', 'Descripción de afectaciones',
  'Acciones inmediatas', 'Estado',
];

// Índices 1-based de columnas.
var COL = {
  ID: 1, REPORTANTE: 4, CORREO: 5, TELEFONO: 6,
  DEPARTAMENTO: 7, MUNICIPIO: 8, VEREDA: 9, INSTITUCION: 10, SEDE: 11,
  RECTOR: 12, ESTUDIANTES: 13, AFECTACIONES: 14, DESCRIPCION: 15,
  ACCIONES: 16, ESTADO: 17,
};

var DEPARTAMENTOS_VALIDOS = ['Caldas', 'Risaralda', 'Quindío', 'Valle del Cauca'];

// ─── Router HTTP ────────────────────────────────────────────

function doGet(e) {
  try {
    var accion = (e && e.parameter && e.parameter.accion) || '';
    if (accion === 'reportantes') return jsonResponse(reportantes_());
    if (accion === 'misRegistros') return jsonResponse(misRegistros_((e.parameter && e.parameter.reportante) || ''));
    return errorResponse('Acción no reconocida: ' + accion);
  } catch (err) {
    return errorResponse(err.message);
  }
}

function doPost(e) {
  try {
    var datos = JSON.parse(e.postData.contents);
    var accion = datos.accion || '';
    switch (accion) {
      case 'guardarRegistro':
        return jsonResponse(guardarRegistro_(datos));
      case 'eliminarRegistro':
        return jsonResponse(eliminarRegistro_(datos));
      default:
        return errorResponse('Acción no reconocida: ' + accion);
    }
  } catch (err) {
    return errorResponse(err.message);
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Normalización "Nombre Propio" ──────────────────────────
// Misma lógica que js/texto.js (nombrePropio) — duplicada aquí porque el
// backend es la última línea de defensa: nada entra al Sheet sin pasar por
// ella, sin importar qué llegue por POST.

var CONECTORES_ = ['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'con', 'para', 'por', 'un', 'una'];

function nombrePropio_(texto) {
  if (texto === null || texto === undefined) return '';
  var limpio = String(texto).trim().replace(/\s+/g, ' ');
  if (!limpio) return '';

  var esPrimeraPalabra = true;
  var palabras = limpio.split(' ').map(function (palabra) {
    if (!palabra) return palabra;
    var segmentos = palabra.split(/([.-])/).map(function (parte) {
      if (parte === '.' || parte === '-') return parte;
      if (!parte) return parte;
      var out = capitalizarSegmento_(parte, esPrimeraPalabra);
      esPrimeraPalabra = false;
      return out;
    });
    return segmentos.join('');
  });
  return palabras.join(' ');
}

function capitalizarSegmento_(segmento, esPrimeraPalabra) {
  var minusc = segmento.toLowerCase();
  if (!esPrimeraPalabra && CONECTORES_.indexOf(minusc) !== -1) return minusc;
  return capitalizarPalabra_(segmento);
}

function capitalizarPalabra_(palabra) {
  if (!palabra) return palabra;
  if (palabra.length <= 5 && /^[ivxlcdm]+$/i.test(palabra)) return palabra.toUpperCase();
  return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
}

// ─── Claves naturales ───────────────────────────────────────

function claveRegistro_(departamento, municipio, institucion, sede) {
  return [departamento, municipio, institucion, sede].map(normalizarClave_).join('|');
}

function normalizarClave_(s) {
  return String(s || '').trim().toLowerCase();
}

// ─── GET ?accion=reportantes ─────────────────────────────────
// Nombre, correo, teléfono y departamento más recientes por cada reportante
// que ya tenga filas en "registros" — para autocompletar el paso 1 del
// formulario. No hay una lista sembrada de antemano (a diferencia de
// PADRINOS_SEED en el proyecto del sismo): se deriva de lo que ya se guardó.

function reportantes_() {
  var sheet = getSheet_('registros');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var filas = sheet.getRange(2, 1, lastRow - 1, HEADERS_REGISTROS.length).getValues();
  var porNombre = {};
  filas.forEach(function (f) {
    var nombre = String(f[COL.REPORTANTE - 1] || '').trim();
    if (!nombre) return;
    porNombre[normalizarClave_(nombre)] = {
      nombre: nombre,
      correo: String(f[COL.CORREO - 1] || '').trim(),
      telefono: String(f[COL.TELEFONO - 1] || '').trim(),
      departamento: String(f[COL.DEPARTAMENTO - 1] || '').trim(),
    };
  });
  return Object.keys(porNombre).map(function (k) { return porNombre[k]; });
}

// ─── GET ?accion=misRegistros&reportante=... ────────────────
// Filas ya guardadas (Borrador o Completo) por ese reportante, para que las
// retome y complete después sin duplicarlas.

function misRegistros_(nombreReportante) {
  var sheet = getSheet_('registros');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || !nombreReportante) return [];

  var clave = normalizarClave_(nombreReportante);
  var filas = sheet.getRange(2, 1, lastRow - 1, HEADERS_REGISTROS.length).getValues();
  var resultado = [];

  filas.forEach(function (f) {
    if (normalizarClave_(f[COL.REPORTANTE - 1]) !== clave) return;
    resultado.push(filaAObjeto_(f));
  });
  return resultado;
}

function filaAObjeto_(f) {
  var afectaciones = [];
  try { afectaciones = JSON.parse(f[COL.AFECTACIONES - 1] || '[]'); } catch (e) { afectaciones = []; }
  return {
    id: f[COL.ID - 1],
    marcaTemporal: f[1],
    actualizado: f[2],
    reportante: f[COL.REPORTANTE - 1],
    correoReportante: f[COL.CORREO - 1],
    telefonoReportante: f[COL.TELEFONO - 1],
    departamento: f[COL.DEPARTAMENTO - 1],
    municipio: f[COL.MUNICIPIO - 1],
    vereda: f[COL.VEREDA - 1],
    institucion: f[COL.INSTITUCION - 1],
    sede: f[COL.SEDE - 1],
    rector: f[COL.RECTOR - 1],
    numeroEstudiantes: f[COL.ESTUDIANTES - 1],
    afectaciones: afectaciones,
    descripcionAfectaciones: f[COL.DESCRIPCION - 1],
    accionesInmediatas: f[COL.ACCIONES - 1],
    estado: f[COL.ESTADO - 1],
  };
}

function buscarFilaPorClave_(sheet, clave) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var filas = sheet.getRange(2, 1, lastRow - 1, HEADERS_REGISTROS.length).getValues();
  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];
    var claveFila = claveRegistro_(f[COL.DEPARTAMENTO - 1], f[COL.MUNICIPIO - 1], f[COL.INSTITUCION - 1], f[COL.SEDE - 1]);
    if (claveFila === clave) return { numeroFila: i + 2, valores: f };
  }
  return null;
}

function siguienteId_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    .map(function (f) { return parseInt(f[0], 10); })
    .filter(function (n) { return !isNaN(n); });
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
}

// ─── POST accion=guardarRegistro ────────────────────────────
// Upsert por clave natural Departamento|Municipio|Institución|Sede: si la
// sede ya estaba guardada por el mismo reportante, actualiza esa fila; si
// no existe, crea una nueva. Todos los campos de texto pasan por
// nombrePropio_() antes de guardarse. Departamento, municipio, institución
// y sede son obligatorios; el resto puede llegar vacío (queda "Borrador").

function guardarRegistro_(datos) {
  var reportante = String((datos.reportante && datos.reportante.nombre) || '').trim();
  var correoReportante = String((datos.reportante && datos.reportante.correo) || '').trim();
  var telefonoReportante = String((datos.reportante && datos.reportante.telefono) || '').trim();

  var departamento = String(datos.departamento || '').trim();
  var municipio = nombrePropio_(datos.municipio);
  var vereda = nombrePropio_(datos.vereda);
  var institucion = nombrePropio_(datos.institucion);
  var sede = nombrePropio_(datos.sede);
  var rector = nombrePropio_(datos.rector);
  var numeroEstudiantes = datos.numeroEstudiantes === '' || datos.numeroEstudiantes === undefined || datos.numeroEstudiantes === null
    ? ''
    : parseInt(datos.numeroEstudiantes, 10) || 0;
  var afectaciones = Array.isArray(datos.afectaciones) ? datos.afectaciones : [];
  var descripcionAfectaciones = String(datos.descripcionAfectaciones || '').trim();
  var accionesInmediatas = String(datos.accionesInmediatas || '').trim();

  if (!reportante) throw new Error('Falta el nombre del reportante.');
  if (DEPARTAMENTOS_VALIDOS.indexOf(departamento) === -1) throw new Error('Departamento no válido: ' + departamento);
  if (!municipio) throw new Error('Falta el municipio.');
  if (!institucion) throw new Error('Falta la institución educativa.');
  if (!sede) throw new Error('Falta la sede.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_('registros');
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS_REGISTROS);

    var clave = claveRegistro_(departamento, municipio, institucion, sede);
    var existente = buscarFilaPorClave_(sheet, clave);
    var esPropio = existente && normalizarClave_(existente.valores[COL.REPORTANTE - 1]) === normalizarClave_(reportante);
    if (existente && !esPropio) {
      throw new Error('La sede "' + sede + '" ya fue registrada por ' + existente.valores[COL.REPORTANTE - 1] + '.');
    }

    var tieneContenido = !!(rector || numeroEstudiantes !== '' || afectaciones.length || descripcionAfectaciones || accionesInmediatas);
    var estado = tieneContenido ? 'Completo' : 'Borrador';
    var ahora = new Date();

    var fila = [
      existente ? existente.valores[COL.ID - 1] : siguienteId_(sheet),
      existente ? existente.valores[1] : ahora,
      ahora,
      reportante, correoReportante, telefonoReportante,
      departamento, municipio, vereda, institucion, sede, rector,
      numeroEstudiantes, JSON.stringify(afectaciones), descripcionAfectaciones,
      accionesInmediatas, estado,
    ];

    if (existente) {
      sheet.getRange(existente.numeroFila, 1, 1, fila.length).setValues([fila]);
      return { id: fila[0], estado: estado, actualizado: true };
    }

    sheet.appendRow(fila);
    return { id: fila[0], estado: estado, actualizado: false };
  } finally {
    lock.releaseLock();
  }
}

// ─── POST accion=eliminarRegistro ───────────────────────────
// Borra una fila por id, solo si pertenece al mismo reportante que la pide
// (mismo criterio de propiedad que guardarRegistro_).

function eliminarRegistro_(datos) {
  var id = String(datos.id || '').trim();
  var reportante = String((datos.reportante && datos.reportante.nombre) || '').trim();
  if (!id) throw new Error('Falta el id del registro.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_('registros');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('No hay registros.');

    var filas = sheet.getRange(2, 1, lastRow - 1, HEADERS_REGISTROS.length).getValues();
    for (var i = 0; i < filas.length; i++) {
      if (String(filas[i][COL.ID - 1]) === id) {
        if (normalizarClave_(filas[i][COL.REPORTANTE - 1]) !== normalizarClave_(reportante)) {
          throw new Error('Ese registro no pertenece a este reportante.');
        }
        sheet.deleteRow(i + 2);
        return { eliminado: true };
      }
    }
    throw new Error('No se encontró el registro.');
  } finally {
    lock.releaseLock();
  }
}

// ─── Funciones auxiliares para leer/escribir el spreadsheet ─

function getResultsSpreadsheet_() {
  if (!RESULTS_SHEET_ID) throw new Error('RESULTS_SHEET_ID está vacío. Ejecuta inicializar() primero.');
  return SpreadsheetApp.openById(RESULTS_SHEET_ID);
}

function getSheet_(nombre) {
  var ss = getResultsSpreadsheet_();
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) sheet = ss.insertSheet(nombre);
  return sheet;
}

// ─── Inicialización (ejecutar UNA vez a mano) ───────────────
// Si RESULTS_SHEET_ID está vacío, crea el spreadsheet y muestra su ID en el
// Logger — cópialo a la constante de arriba para que quede fijo. Si ya
// tiene un ID (porque ya se corrió antes), solo asegura la pestaña
// "registros" con su encabezado.

function inicializar() {
  var ss;
  if (RESULTS_SHEET_ID) {
    ss = SpreadsheetApp.openById(RESULTS_SHEET_ID);
  } else {
    ss = SpreadsheetApp.create('Acciones inmediatas por departamento — Registro');
    moverArchivoACarpeta_(ss.getId(), CARPETA_DRIVE_ID);
    Logger.log('Spreadsheet creado en la carpeta de Drive indicada. Copia este ID a RESULTS_SHEET_ID en Code.gs: ' + ss.getId());
  }

  var hReg = ss.getSheetByName('registros') || ss.insertSheet('registros');
  if (hReg.getLastRow() === 0) hReg.appendRow(HEADERS_REGISTROS);

  var hojaPorDefecto = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hojaPorDefecto && ss.getSheets().length > 1) ss.deleteSheet(hojaPorDefecto);

  Logger.log('Listo. URL del spreadsheet: ' + ss.getUrl());
}

// SpreadsheetApp.create() siempre deja el archivo en la raíz de "Mi unidad";
// esto lo mueve a la carpeta de Drive del proyecto justo después de crearlo.
function moverArchivoACarpeta_(fileId, carpetaId) {
  var archivo = DriveApp.getFileById(fileId);
  var carpetaDestino = DriveApp.getFolderById(carpetaId);
  carpetaDestino.addFile(archivo);
  DriveApp.getRootFolder().removeFile(archivo);
}
