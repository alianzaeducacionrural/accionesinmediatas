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
var RESULTS_SHEET_ID = '1F_FVzOhYuZlnTEkWzsYqmED1tJAi8xz2JrrFCpjV9vY';

// Carpeta de Drive donde debe quedar el spreadsheet y cualquier archivo
// asociado a esta plataforma — indicada por el usuario.
// https://drive.google.com/drive/folders/1cG8pP4XexZ66pnYQn29PrazjIbXFOqdD
var CARPETA_DRIVE_ID = '1cG8pP4XexZ66pnYQn29PrazjIbXFOqdD';

var HEADERS_REGISTROS = [
  'id', 'Marca temporal', 'Actualizado',
  'Reportante', 'Correo reportante', 'Teléfono reportante',
  'Departamento', 'Municipio', 'Vereda', 'Institución', 'Sede', 'Rector',
  'Correo rector', 'Teléfono rector',
  'Número de estudiantes', 'Tipos de afectación', 'Descripción de afectaciones',
  'Acciones sugeridas', 'Aporte del departamento', 'Estado',
];

// Índices 1-based de columnas.
var COL = {
  ID: 1, REPORTANTE: 4, CORREO: 5, TELEFONO: 6,
  DEPARTAMENTO: 7, MUNICIPIO: 8, VEREDA: 9, INSTITUCION: 10, SEDE: 11,
  RECTOR: 12, CORREO_RECTOR: 13, TELEFONO_RECTOR: 14,
  ESTUDIANTES: 15, AFECTACIONES: 16, DESCRIPCION: 17,
  ACCIONES_SUGERIDAS: 18, APORTE_DEPARTAMENTO: 19, ESTADO: 20,
};

var DEPARTAMENTOS_VALIDOS = ['Caldas', 'Risaralda', 'Quindío', 'Valle del Cauca'];

// ─── Router HTTP ────────────────────────────────────────────

function doGet(e) {
  try {
    var accion = (e && e.parameter && e.parameter.accion) || '';
    if (accion === 'reportantes') return jsonResponse(reportantes_());
    if (accion === 'misRegistros') return jsonResponse(misRegistros_((e.parameter && e.parameter.reportante) || ''));
    if (accion === 'todosLosRegistros') return jsonResponse(todosLosRegistros_((e.parameter && e.parameter.departamento) || ''));
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
      case 'editarRegistro':
        return jsonResponse(editarRegistro_(datos));
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

// ─── GET ?accion=todosLosRegistros[&departamento=...] ───────
// Todas las filas (o solo las de un departamento) — a diferencia de
// misRegistros_, no filtra por reportante. La consume el dashboard. El
// filtro por departamento vive aquí, no solo en el cliente, para que un
// enlace filtrado (dashboard.html?departamento=X) nunca haga viajar por la
// red los datos de los otros departamentos.

function todosLosRegistros_(departamento) {
  var sheet = getSheet_('registros');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var filas = sheet.getRange(2, 1, lastRow - 1, HEADERS_REGISTROS.length).getValues();
  var resultado = filas.map(filaAObjeto_);
  if (departamento) {
    resultado = resultado.filter(function (r) { return r.departamento === departamento; });
  }
  return resultado;
}

function filaAObjeto_(f) {
  var afectaciones = [];
  try { afectaciones = JSON.parse(f[COL.AFECTACIONES - 1] || '[]'); } catch (e) { afectaciones = []; }
  var accionesSugeridas = [];
  try { accionesSugeridas = JSON.parse(f[COL.ACCIONES_SUGERIDAS - 1] || '[]'); } catch (e) { accionesSugeridas = []; }
  var aporteDepartamento = [];
  try { aporteDepartamento = JSON.parse(f[COL.APORTE_DEPARTAMENTO - 1] || '[]'); } catch (e) { aporteDepartamento = []; }
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
    correoRector: f[COL.CORREO_RECTOR - 1],
    telefonoRector: f[COL.TELEFONO_RECTOR - 1],
    numeroEstudiantes: f[COL.ESTUDIANTES - 1],
    afectaciones: afectaciones,
    descripcionAfectaciones: f[COL.DESCRIPCION - 1],
    accionesSugeridas: accionesSugeridas,
    aporteDepartamento: aporteDepartamento,
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

function normalizarCamposRegistro_(datos) {
  var reportante = String((datos.reportante && datos.reportante.nombre) || '').trim();
  var correoReportante = String((datos.reportante && datos.reportante.correo) || '').trim();
  var telefonoReportante = String((datos.reportante && datos.reportante.telefono) || '').trim();

  var departamento = String(datos.departamento || '').trim();
  var municipio = nombrePropio_(datos.municipio);
  var vereda = nombrePropio_(datos.vereda);
  var institucion = nombrePropio_(datos.institucion);
  var sede = nombrePropio_(datos.sede);
  var rector = nombrePropio_(datos.rector);
  var correoRector = String(datos.correoRector || '').trim();
  var telefonoRector = String(datos.telefonoRector || '').trim();
  var numeroEstudiantes = datos.numeroEstudiantes === '' || datos.numeroEstudiantes === undefined || datos.numeroEstudiantes === null
    ? ''
    : parseInt(datos.numeroEstudiantes, 10) || 0;
  var afectaciones = Array.isArray(datos.afectaciones) ? datos.afectaciones : [];
  var descripcionAfectaciones = String(datos.descripcionAfectaciones || '').trim();
  var accionesSugeridas = Array.isArray(datos.accionesSugeridas) ? datos.accionesSugeridas : [];
  var aporteDepartamento = Array.isArray(datos.aporteDepartamento) ? datos.aporteDepartamento : [];

  if (!reportante) throw new Error('Falta el nombre del reportante.');
  if (DEPARTAMENTOS_VALIDOS.indexOf(departamento) === -1) throw new Error('Departamento no válido: ' + departamento);
  if (!municipio) throw new Error('Falta el municipio.');
  if (!institucion) throw new Error('Falta la institución educativa.');
  if (!sede) throw new Error('Falta la sede.');

  return {
    reportante: reportante, correoReportante: correoReportante, telefonoReportante: telefonoReportante,
    departamento: departamento, municipio: municipio, vereda: vereda, institucion: institucion, sede: sede,
    rector: rector, correoRector: correoRector, telefonoRector: telefonoRector,
    numeroEstudiantes: numeroEstudiantes, afectaciones: afectaciones,
    descripcionAfectaciones: descripcionAfectaciones, accionesSugeridas: accionesSugeridas,
    aporteDepartamento: aporteDepartamento,
  };
}

function estadoRegistro_(campos) {
  var tieneContenido = !!(campos.rector || campos.correoRector || campos.telefonoRector ||
    campos.numeroEstudiantes !== '' || campos.afectaciones.length || campos.descripcionAfectaciones ||
    campos.accionesSugeridas.length || campos.aporteDepartamento.length);
  return tieneContenido ? 'Completo' : 'Borrador';
}

function guardarRegistro_(datos) {
  var campos = normalizarCamposRegistro_(datos);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_('registros');
    asegurarEncabezadoRegistros_(sheet);

    var clave = claveRegistro_(campos.departamento, campos.municipio, campos.institucion, campos.sede);
    var existente = buscarFilaPorClave_(sheet, clave);
    var esPropio = existente && normalizarClave_(existente.valores[COL.REPORTANTE - 1]) === normalizarClave_(campos.reportante);
    if (existente && !esPropio) {
      throw new Error('La sede "' + campos.sede + '" ya fue registrada por ' + existente.valores[COL.REPORTANTE - 1] + '.');
    }

    var estado = estadoRegistro_(campos);
    var ahora = new Date();

    var fila = [
      existente ? existente.valores[COL.ID - 1] : siguienteId_(sheet),
      existente ? existente.valores[1] : ahora,
      ahora,
      campos.reportante, campos.correoReportante, comoTexto_(campos.telefonoReportante),
      campos.departamento, campos.municipio, campos.vereda, campos.institucion, campos.sede, campos.rector,
      campos.correoRector, comoTexto_(campos.telefonoRector),
      campos.numeroEstudiantes, JSON.stringify(campos.afectaciones), campos.descripcionAfectaciones,
      JSON.stringify(campos.accionesSugeridas), JSON.stringify(campos.aporteDepartamento), estado,
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

// ─── POST accion=editarRegistro ─────────────────────────────
// Actualiza por id, sin restricción de reportante: a diferencia de
// guardarRegistro_ (formulario público, upsert por clave natural + dueño),
// esta acción la usa el dashboard, un panel administrativo sin sesión de
// reportante. Conserva la Marca temporal original y recalcula Estado.

function editarRegistro_(datos) {
  var id = String(datos.id || '').trim();
  if (!id) throw new Error('Falta el id del registro.');
  var campos = normalizarCamposRegistro_(datos);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_('registros');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('No hay registros.');
    var filas = sheet.getRange(2, 1, lastRow - 1, HEADERS_REGISTROS.length).getValues();

    var numeroFila = -1, original = null;
    for (var i = 0; i < filas.length; i++) {
      if (String(filas[i][COL.ID - 1]) === id) { numeroFila = i + 2; original = filas[i]; break; }
    }
    if (numeroFila === -1) throw new Error('No se encontró el registro.');

    var clave = claveRegistro_(campos.departamento, campos.municipio, campos.institucion, campos.sede);
    for (var j = 0; j < filas.length; j++) {
      if (String(filas[j][COL.ID - 1]) === id) continue;
      var claveOtra = claveRegistro_(filas[j][COL.DEPARTAMENTO - 1], filas[j][COL.MUNICIPIO - 1], filas[j][COL.INSTITUCION - 1], filas[j][COL.SEDE - 1]);
      if (claveOtra === clave) throw new Error('Ya existe otra sede con esa combinación de Departamento/Municipio/Institución/Sede.');
    }

    var estado = estadoRegistro_(campos);
    var fila = [
      id, original[1], new Date(),
      campos.reportante, campos.correoReportante, comoTexto_(campos.telefonoReportante),
      campos.departamento, campos.municipio, campos.vereda, campos.institucion, campos.sede, campos.rector,
      campos.correoRector, comoTexto_(campos.telefonoRector),
      campos.numeroEstudiantes, JSON.stringify(campos.afectaciones), campos.descripcionAfectaciones,
      JSON.stringify(campos.accionesSugeridas), JSON.stringify(campos.aporteDepartamento), estado,
    ];
    sheet.getRange(numeroFila, 1, 1, fila.length).setValues([fila]);
    return { id: id, estado: estado };
  } finally {
    lock.releaseLock();
  }
}

// ─── POST accion=eliminarRegistro ───────────────────────────
// Borra una fila por id. Sin restricción de reportante: la usan tanto el
// formulario público (borrar lo propio, aunque hoy no hay un flujo de
// cliente que lo llame) como el dashboard (panel administrativo sin sesión
// de reportante).

function eliminarRegistro_(datos) {
  var id = String(datos.id || '').trim();
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

// Fuerza que un teléfono se guarde como texto y no como número. setValues
// interpreta strings "que parecen número" igual que si se escribieran a
// mano en Sheets — arriesgando perder ceros a la izquierda y complicando
// el resto del código, que espera un string. La comilla simple al inicio
// es la misma convención que usa la interfaz de Sheets para forzar texto:
// Apps Script la respeta y no queda como caracter literal en la celda.
function comoTexto_(valor) {
  return valor ? "'" + valor : valor;
}

// Crea el encabezado de "registros" si la pestaña está vacía, o lo
// reescribe si cambió HEADERS_REGISTROS y todavía no hay filas de datos
// reales — así el esquema se puede evolucionar sin migración manual
// mientras el Sheet siga vacío. Nunca toca una pestaña con datos.
function asegurarEncabezadoRegistros_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS_REGISTROS);
    return;
  }
  if (sheet.getLastRow() === 1) {
    var actual = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].join('|');
    if (actual !== HEADERS_REGISTROS.join('|')) {
      sheet.clearContents();
      sheet.appendRow(HEADERS_REGISTROS);
    }
  }
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
  asegurarEncabezadoRegistros_(hReg);
  asegurarColumnasTexto_(hReg);

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
