// ================================================
// PANEL DE CONTROL — Acciones inmediatas por departamento
// Trae todos los registros (accion=todosLosRegistros[&departamento=&token=])
// y arma KPIs, gráficos caseros (sin librerías) y una tabla con
// edición/eliminación directa.
//
// Este script lo comparten 5 páginas:
//  - dashboard.html: vista consolidada de los 4 departamentos, para el
//    equipo central (pestañas para cambiar de departamento, sin token —
//    usa el mapa TOKENS_DEPARTAMENTO de js/dashboard-tokens.js, que SOLO
//    carga esta página).
//  - dashboard-caldas.html / dashboard-risaralda.html / dashboard-quindio.html
//    / dashboard-valle-del-cauca.html: un departamento fijo cada una
//    (window.DASHBOARD_FIJO, definido en un <script> inline propio de cada
//    archivo), sin pestañas, con el token leído de la URL (?t=...) — nunca
//    cargan dashboard-tokens.js, así que el código fuente de estas páginas
//    nunca expone los tokens de los otros departamentos.
//
// El backend (doGet en gas/Code.gs) exige el token correcto cuando se pide
// un departamento puntual — es una barrera de obscuridad (el token viaja
// en la URL y en el JS del dashboard consolidado), no autenticación real,
// pero evita que cambiar "?departamento=" a mano alcance para ver otro
// departamento.
// ================================================

const CATEGORIAS_AFECTACION = [
  'Estructural', 'Cubierta y techos', 'Pisos y andenes', 'Baterías sanitarias',
  'Acueducto / agua potable', 'Energía eléctrica', 'Conectividad / internet',
  'Mobiliario y dotación', 'Restaurante escolar / cocina', 'Vías de acceso',
  'Zonas deportivas', 'Vivienda de docentes', 'Otra', 'Sin afectaciones',
];

const ACCIONES_PREDEFINIDAS = [
  'Ruta de apoyo psicosocial y socioemocional para niños, docentes y familias',
  'Campamentos, carpas o aulas temporales con baterías sanitarias temporales',
  'Reposición de mobiliario, guías y dotación de restaurante u otros elementos afectados',
];
const ETIQUETAS_ACCIONES = {
  'Ruta de apoyo psicosocial y socioemocional para niños, docentes y familias': 'Ruta de apoyo psicosocial y socioemocional',
  'Campamentos, carpas o aulas temporales con baterías sanitarias temporales': 'Campamentos/aulas temporales con baterías sanitarias',
  'Reposición de mobiliario, guías y dotación de restaurante u otros elementos afectados': 'Reposición de mobiliario y dotación de restaurante',
};

const CATEGORIAS_APORTE = ['Especie', 'Capacidad', 'Recurso económico'];

let registros = [];
let departamentoActivo = null; // null = "Todos"
let modoConsolidado = false;
let orden = { campo: 'actualizadoTiempo', dir: 'desc' };

// Solo en las páginas de departamento fijo (dashboard-caldas.html, etc.):
// departamentoFijo viene de window.DASHBOARD_FIJO (inline en cada archivo),
// tokenActual del parámetro ?t= de la URL que se compartió con ese equipo.
let departamentoFijo = null;
let tokenActual = '';

document.addEventListener('DOMContentLoaded', iniciar);

function iniciar() {
  poblarPestanas();
  configurarFiltrosEventos();
  configurarPanelDetalle();
  document.getElementById('btnActualizar').addEventListener('click', recargarDatosActuales);
  document.getElementById('btnReintentarCarga').addEventListener('click', recargarDatosActuales);
  document.getElementById('btnDescargarExcel').addEventListener('click', descargarCsv);

  if (window.DASHBOARD_FIJO) {
    departamentoFijo = window.DASHBOARD_FIJO.departamento;
    tokenActual = new URLSearchParams(location.search).get('t') || '';
    document.getElementById('panelPestanas').classList.add('oculto');
    // La tarjeta "Aporte del departamento" de la grilla de gráficos queda
    // redundante aquí (un solo departamento en pantalla) — se reemplaza
    // por las etiquetas junto al título.
    document.getElementById('bloqueAporteDepartamento').classList.add('oculto');
    document.getElementById('bloqueDepartamentoTitulo').classList.remove('oculto');
    document.getElementById('departamentoTitulo').textContent = departamentoFijo;
    cambiarPestana(departamentoFijo);
  } else {
    cambiarPestana(null);
  }
}

// ─── Utilidades ──────────────────────────────────────────────

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function iconoSvg(id) {
  return `<svg class="icono-svg" aria-hidden="true"><use href="#${id}"></use></svg>`;
}

function escaparHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s == null ? '' : s);
  return div.innerHTML;
}

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
}

function formatearFecha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function postGAS(payload) {
  if (!CONFIG.GAS_URL) throw new Error('El backend todavía no está configurado (CONFIG.GAS_URL vacío).');
  const res = await fetch(CONFIG.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // evita el preflight CORS que Apps Script no maneja
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

async function getGAS(params) {
  if (!CONFIG.GAS_URL) throw new Error('El backend todavía no está configurado (CONFIG.GAS_URL vacío).');
  const url = `${CONFIG.GAS_URL}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

// ─── Pestañas por departamento ───────────────────────────────

function poblarPestanas() {
  const nav = document.getElementById('panelPestanas');
  const btnTodos = document.createElement('button');
  btnTodos.type = 'button';
  btnTodos.className = 'pestana';
  btnTodos.dataset.depto = '';
  btnTodos.textContent = 'Todos';
  nav.appendChild(btnTodos);

  DEPARTAMENTOS.forEach((d) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pestana';
    btn.dataset.depto = d;
    btn.textContent = d;
    nav.appendChild(btn);
  });

  nav.querySelectorAll('.pestana').forEach((btn) => {
    btn.addEventListener('click', () => cambiarPestana(btn.dataset.depto || null));
  });
}

// Cambia de pestaña. La carga de datos respeta la nota de seguridad de
// cargarDatos(): solo entrar o volver a "Todos" trae el consolidado; cambiar
// a un departamento específico sin haber cargado ya el consolidado dispara
// un fetch nuevo acotado a ese departamento — nunca los otros tres viajan
// por la red sin que el usuario haya pedido explícitamente "Todos".
async function cambiarPestana(depto) {
  departamentoActivo = depto;
  document.querySelectorAll('#panelPestanas .pestana').forEach((btn) => {
    btn.classList.toggle('activa', (btn.dataset.depto || null) === depto);
  });

  if (depto === null && !modoConsolidado) {
    await cargarDatos(null);
    modoConsolidado = true;
    return; // cargarDatos ya renderiza
  }
  if (depto !== null && !modoConsolidado) {
    await cargarDatos(depto);
    return;
  }
  poblarFiltroMunicipio();
  renderizarTodo();
}

function recargarDatosActuales() {
  cargarDatos(modoConsolidado ? null : departamentoActivo);
}

// ─── Carga ───────────────────────────────────────────────────

async function cargarDatos(depto) {
  document.getElementById('panelCargando').classList.remove('oculto');
  document.getElementById('panelError').classList.add('oculto');
  document.getElementById('panelContenido').classList.add('oculto');

  try {
    const params = { accion: 'todosLosRegistros' };
    if (depto) {
      params.departamento = depto;
      // Solo las páginas de departamento fijo piden un departamento puntual
      // desde cero (el dashboard consolidado siempre carga "Todos" primero
      // y después filtra en memoria — nunca vuelve a pedir un departamento
      // solo, así que nunca necesita adjuntar un token aquí).
      if (departamentoFijo) params.token = tokenActual;
    }
    const data = await getGAS(params);
    registros = data.map(prepararFila);

    poblarFiltroMunicipio();
    renderizarTodo();

    document.getElementById('panelActualizado').textContent =
      'Actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('panelCargando').classList.add('oculto');
    document.getElementById('panelContenido').classList.remove('oculto');
  } catch (err) {
    document.getElementById('panelCargando').classList.add('oculto');
    document.getElementById('panelError').classList.remove('oculto');
    const mensaje = document.getElementById('panelErrorMensaje');
    if (mensaje) mensaje.textContent = err.message || 'No se pudo cargar la información.';
  }
}

function prepararFila(r) {
  return {
    ...r,
    estudiantesNum: r.numeroEstudiantes === '' || r.numeroEstudiantes == null ? null : Number(r.numeroEstudiantes),
    actualizadoTiempo: r.actualizado ? (new Date(r.actualizado).getTime() || 0) : 0,
  };
}

function poblarFiltroMunicipio() {
  const sel = document.getElementById('filtroMunicipio');
  const anterior = sel.value;
  const enAlcance = registros.filter((r) => !departamentoActivo || r.departamento === departamentoActivo);
  const municipios = [...new Set(enAlcance.map((r) => r.municipio))].sort((a, b) => a.localeCompare(b, 'es'));
  sel.innerHTML = '<option value="">Todos los municipios</option>';
  municipios.forEach((m) => sel.add(new Option(m, m)));
  if (municipios.indexOf(anterior) !== -1) sel.value = anterior;
}

// ─── Filtros + orden ─────────────────────────────────────────

function configurarFiltrosEventos() {
  document.getElementById('filtroTexto').addEventListener('input', debounce(renderizarTodo, 200));
  document.getElementById('filtroMunicipio').addEventListener('change', renderizarTodo);
  document.getElementById('filtroAfectacion').addEventListener('change', renderizarTodo);
  document.getElementById('btnLimpiarFiltros').addEventListener('click', () => {
    document.getElementById('filtroTexto').value = '';
    document.getElementById('filtroMunicipio').value = '';
    document.getElementById('filtroAfectacion').value = '';
    renderizarTodo();
  });

  document.querySelectorAll('#tablaRegistros thead th[data-orden]').forEach((th) => {
    th.addEventListener('click', () => {
      const campo = th.dataset.orden;
      if (orden.campo === campo) orden.dir = orden.dir === 'asc' ? 'desc' : 'asc';
      else { orden.campo = campo; orden.dir = 'asc'; }
      renderizarTodo();
    });
  });
}

function obtenerFiltrados() {
  const texto = document.getElementById('filtroTexto').value.trim().toLowerCase();
  const municipio = document.getElementById('filtroMunicipio').value;
  const afectacion = document.getElementById('filtroAfectacion').value;

  let lista = registros.filter((r) => {
    if (departamentoActivo && r.departamento !== departamentoActivo) return false;
    if (municipio && r.municipio !== municipio) return false;
    if (afectacion && !(r.afectaciones || []).includes(afectacion)) return false;
    if (texto) {
      const haystack = `${r.municipio} ${r.institucion} ${r.sede} ${r.rector || ''} ${r.reportante || ''}`.toLowerCase();
      if (!haystack.includes(texto)) return false;
    }
    return true;
  });

  lista.sort((a, b) => {
    const va = a[orden.campo];
    const vb = b[orden.campo];
    let cmp;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else cmp = String(va || '').localeCompare(String(vb || ''), 'es');
    return orden.dir === 'asc' ? cmp : -cmp;
  });

  return lista;
}

function renderizarTodo() {
  const filtrados = obtenerFiltrados();
  renderEnlacesDepartamento();
  renderKpis(filtrados);
  renderGraficoDepartamento(filtrados);
  renderGraficoMunicipio(filtrados);
  renderGraficoAfectaciones(filtrados);
  renderGraficoAcciones(filtrados);
  renderAporteDepartamento(filtrados);
  renderTabla(filtrados);
  actualizarEncabezadosOrden();
}

// Los 4 departamentos válidos son un conjunto fijo (DEPARTAMENTOS en
// js/catalogo.js) — un reemplazo literal es más simple y confiable aquí
// que un rango Unicode de diacríticos para un solo caso (Quindío).
function slugDepartamento(depto) {
  return depto.replace('í', 'i').toLowerCase().replace(/\s+/g, '-');
}

// Solo tiene sentido en la pestaña "Todos" del dashboard consolidado: cada
// enlace apunta a la página dedicada de ese departamento (dashboard-caldas.html,
// etc.) con su token — solo se puede armar aquí porque este dashboard es el
// único que carga js/dashboard-tokens.js.
function renderEnlacesDepartamento() {
  const bloque = document.getElementById('bloqueEnlacesDepartamento');
  if (departamentoActivo || typeof TOKENS_DEPARTAMENTO === 'undefined') {
    bloque.classList.add('oculto');
    return;
  }
  bloque.classList.remove('oculto');
  const base = location.href.slice(0, location.href.lastIndexOf('/') + 1);
  const cont = document.getElementById('listaEnlacesDepartamento');
  cont.innerHTML = DEPARTAMENTOS.map((d) => {
    const url = `${base}dashboard-${slugDepartamento(d)}.html?t=${encodeURIComponent(TOKENS_DEPARTAMENTO[d])}`;
    return `
      <div class="enlace-departamento-item">
        <a href="${escaparHtml(url)}">${iconoSvg('icono-enlace')} ${escaparHtml(d)}</a>
        <button type="button" class="btn-texto" data-url="${escaparHtml(url)}">Copiar enlace</button>
      </div>`;
  }).join('');
  cont.querySelectorAll('button[data-url]').forEach((btn) => {
    btn.addEventListener('click', () => copiarEnlace(btn));
  });
}

function copiarEnlace(btn) {
  const url = btn.dataset.url;
  if (!navigator.clipboard || !navigator.clipboard.writeText) return;
  navigator.clipboard.writeText(url).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copiado ✓';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => { /* el enlace sigue disponible como texto/href aunque falle copiar */ });
}

// ─── KPIs ────────────────────────────────────────────────────

function renderKpis(filtrados) {
  document.getElementById('kpiSedes').textContent = filtrados.length;

  const instituciones = new Set(filtrados.map((r) => `${r.departamento}|${r.municipio}|${r.institucion}`.toLowerCase()));
  document.getElementById('kpiInstituciones').textContent = instituciones.size;

  const municipios = new Set(filtrados.map((r) => `${r.departamento}|${r.municipio}`.toLowerCase()));
  document.getElementById('kpiMunicipios').textContent = municipios.size;

  const estudiantes = filtrados.reduce((acc, r) => acc + (r.estudiantesNum || 0), 0);
  document.getElementById('kpiEstudiantes').textContent = estudiantes.toLocaleString('es-CO');
}

// ─── Gráficos: barras horizontales caseras ──────────────────
// Un único renderer genérico (etiqueta + pista + valor) reutilizado por los
// cinco gráficos — todos son "conteo por categoría", ninguno necesita
// segmentos apilados.

function renderBarrasSimple(contenedorId, entradas, { color = 'var(--indigo-500)', vacio = 'Sin datos para los filtros actuales.', onClick } = {}) {
  const cont = document.getElementById(contenedorId);
  if (!entradas.length) {
    cont.innerHTML = `<p class="tabla-vacia">${vacio}</p>`;
    return;
  }
  const max = Math.max(...entradas.map((e) => e.total), 1);
  cont.innerHTML = entradas
    .map((e) => `
      <div class="fila-barra${onClick ? ' fila-barra-click' : ''}" data-clave="${escaparHtml(e.clave)}">
        <span class="etiqueta-barra" title="${escaparHtml(e.etiqueta)}">${escaparHtml(e.etiqueta)}</span>
        <div class="pista-barra"><div class="segmento" style="width:${Math.round((e.total / max) * 100)}%; background-color:${color};"></div></div>
        <span class="valor-barra">${e.total}</span>
      </div>`)
    .join('');
  if (onClick) {
    cont.querySelectorAll('[data-clave]').forEach((el) => el.addEventListener('click', () => onClick(el.dataset.clave)));
  }
}

// Solo tiene sentido en la pestaña "Todos": en una pestaña de departamento
// específico sería una sola barra al 100%, así que se oculta la tarjeta.
function renderGraficoDepartamento(filtrados) {
  const bloque = document.getElementById('bloqueGraficoDepartamento');
  if (departamentoActivo) {
    bloque.classList.add('oculto');
    return;
  }
  bloque.classList.remove('oculto');
  const conteo = {};
  filtrados.forEach((r) => { conteo[r.departamento] = (conteo[r.departamento] || 0) + 1; });
  const entradas = DEPARTAMENTOS.filter((d) => conteo[d])
    .map((d) => ({ clave: d, etiqueta: d, total: conteo[d] }))
    .sort((a, b) => b.total - a.total);
  renderBarrasSimple('graficoDepartamento', entradas, {
    color: 'var(--indigo-700)',
    onClick: (clave) => cambiarPestana(clave),
  });
}

// Agrupa por municipio+departamento (mismo nombre de municipio no debería
// repetirse entre los 4 departamentos de este catálogo, pero se guarda con
// la clave compuesta por seguridad); en la vista consolidada la etiqueta
// aclara el departamento entre paréntesis.
function renderGraficoMunicipio(filtrados) {
  const mapa = new Map();
  filtrados.forEach((r) => {
    const clave = `${r.departamento}|${r.municipio}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave: r.municipio,
        etiqueta: departamentoActivo ? r.municipio : `${r.municipio} (${r.departamento})`,
        total: 0,
      });
    }
    mapa.get(clave).total++;
  });
  const entradas = [...mapa.values()].sort((a, b) => b.total - a.total);
  document.getElementById('notaMunicipios').textContent = `${entradas.length} municipio${entradas.length === 1 ? '' : 's'} con reportes`;
  renderBarrasSimple('graficoMunicipio', entradas, {
    color: 'var(--indigo-500)',
    onClick: (clave) => {
      const sel = document.getElementById('filtroMunicipio');
      sel.value = sel.value === clave ? '' : clave;
      renderizarTodo();
    },
  });
}

function renderGraficoAfectaciones(filtrados) {
  const conteo = {};
  filtrados.forEach((r) => (r.afectaciones || []).forEach((a) => { conteo[a] = (conteo[a] || 0) + 1; }));
  const entradas = CATEGORIAS_AFECTACION
    .filter((c) => conteo[c])
    .map((c) => ({ clave: c, etiqueta: c, total: conteo[c] }))
    .sort((a, b) => b.total - a.total);
  renderBarrasSimple('graficoAfectaciones', entradas, {
    color: 'var(--ambar-500)',
    onClick: (clave) => {
      const sel = document.getElementById('filtroAfectacion');
      sel.value = sel.value === clave ? '' : clave;
      renderizarTodo();
    },
  });
}

// Las 3 acciones predefinidas + un bucket "Otra" que agrupa todo el texto
// libre que no coincide con ninguna (no tiene sentido una barra por cada
// texto distinto escrito a mano).
function renderGraficoAcciones(filtrados) {
  const conteo = {};
  let otras = 0;
  filtrados.forEach((r) => (r.accionesSugeridas || []).forEach((a) => {
    if (ACCIONES_PREDEFINIDAS.indexOf(a) !== -1) conteo[a] = (conteo[a] || 0) + 1;
    else otras++;
  }));
  const entradas = ACCIONES_PREDEFINIDAS
    .filter((a) => conteo[a])
    .map((a) => ({ clave: a, etiqueta: ETIQUETAS_ACCIONES[a], total: conteo[a] }));
  if (otras) entradas.push({ clave: '__otra__', etiqueta: 'Otra (texto libre)', total: otras });
  entradas.sort((a, b) => b.total - a.total);
  renderBarrasSimple('graficoAcciones', entradas, { color: 'var(--indigo-600)' });
}

// Aporte del departamento es un campo global por envío (no por sede): no
// tiene sentido contarlo como las demás barras (una misma categoría
// aparecería una vez por cada sede del envío). En cambio se muestra como
// etiquetas de presencia/ausencia por departamento — ¿ese departamento
// declaró Especie/Capacidad/Recurso económico en algún envío, sí o no?
//
// En una página de departamento fijo no tiene sentido repetir su nombre en
// una tarjeta aparte (ya está en el título de la página) — las etiquetas
// se pintan junto al título en su lugar (ver renderAporteHero).
function renderAporteDepartamento(filtrados) {
  if (departamentoFijo) {
    renderAporteHero(filtrados);
    return;
  }

  const cont = document.getElementById('aporteDepartamento');
  const deptosEnAlcance = departamentoActivo ? [departamentoActivo] : DEPARTAMENTOS;

  const porDepto = {};
  filtrados.forEach((r) => {
    if (!porDepto[r.departamento]) porDepto[r.departamento] = new Set();
    (r.aporteDepartamento || []).forEach((a) => porDepto[r.departamento].add(a));
  });

  cont.innerHTML = deptosEnAlcance.map((d) => {
    const categorias = CATEGORIAS_APORTE.filter((c) => porDepto[d] && porDepto[d].has(c));
    const etiquetas = categorias.length
      ? `<div class="chips-solo-lectura">${categorias.map((c) => `<span class="chip-lectura">${escaparHtml(c)}</span>`).join('')}</div>`
      : '<span class="aporte-departamento-vacio">Sin aporte registrado</span>';
    return `
      <div class="aporte-departamento-fila">
        <span class="aporte-departamento-nombre">${escaparHtml(d)}</span>
        ${etiquetas}
      </div>`;
  }).join('');
}

function renderAporteHero(filtrados) {
  const cont = document.getElementById('departamentoAporteChips');
  const categorias = new Set();
  filtrados.forEach((r) => (r.aporteDepartamento || []).forEach((a) => categorias.add(a)));
  const activas = CATEGORIAS_APORTE.filter((c) => categorias.has(c));

  cont.innerHTML = activas.length
    ? activas.map((c) => `<span class="chip-lectura">${escaparHtml(c)}</span>`).join('')
    : '<span class="aporte-departamento-vacio">Sin aporte registrado</span>';
}

// ─── Tabla ───────────────────────────────────────────────────

function renderTabla(filtrados) {
  const tabla = document.getElementById('tablaRegistros');
  const tbody = document.getElementById('tablaRegistrosBody');
  const vacia = document.getElementById('tablaVacia');
  document.getElementById('notaTabla').textContent = `${filtrados.length} sede${filtrados.length === 1 ? '' : 's'}`;
  tabla.classList.toggle('oculta-departamento', !!departamentoActivo);

  if (filtrados.length === 0) {
    tbody.innerHTML = '';
    vacia.classList.remove('oculto');
    return;
  }
  vacia.classList.add('oculto');

  tbody.innerHTML = filtrados
    .map((r, i) => `
      <tr data-idx="${i}">
        <td class="col-departamento">${escaparHtml(r.departamento)}</td>
        <td>${escaparHtml(r.municipio)}</td>
        <td class="col-institucion">${escaparHtml(r.institucion)}</td>
        <td class="col-sede">${escaparHtml(r.sede)}</td>
        <td>${escaparHtml(r.rector || '—')}</td>
        <td class="col-estudiantes">${r.estudiantesNum != null ? escaparHtml(r.estudiantesNum) : '—'}</td>
        <td class="col-ver"><button type="button" class="btn-ver-mas">Ver más ${iconoSvg('icono-chevron')}</button></td>
      </tr>`)
    .join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => abrirDetalle(filtrados[Number(tr.dataset.idx)]));
  });
}

function actualizarEncabezadosOrden() {
  document.querySelectorAll('#tablaRegistros thead th[data-orden]').forEach((th) => {
    const activo = th.dataset.orden === orden.campo;
    th.classList.toggle('orden-activo', activo);
    th.classList.toggle('orden-desc', activo && orden.dir === 'desc');
  });
}

// ─── Descargar Excel (CSV) ───────────────────────────────────
// Excel abre .csv directo con doble clic; exporta lo que está filtrado en
// pantalla, así que en un enlace por departamento (?departamento=X) solo
// puede exportar los datos de ese departamento — nunca llegaron los otros
// tres al navegador (misma nota de seguridad que cargarDatos()).

function sufijoArchivo() {
  return departamentoActivo ? slugDepartamento(departamentoActivo) : 'todos';
}

function descargarCsv() {
  const filtrados = obtenerFiltrados();
  const encabezados = [
    'Departamento', 'Municipio', 'Vereda', 'Institución', 'Sede',
    'Rector', 'Teléfono rector', 'Correo rector',
    'Reportante', 'Teléfono reportante', 'Correo reportante',
    'Número de estudiantes', 'Tipos de afectación', 'Descripción de afectaciones',
    'Acciones sugeridas', 'Aporte del departamento', 'Actualizado',
  ];
  const csvEscapar = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const unir = (lista) => (lista || []).join(' · ');

  const lineas = [encabezados.map(csvEscapar).join(',')];
  filtrados.forEach((r) => {
    lineas.push(
      [
        r.departamento, r.municipio, r.vereda, r.institucion, r.sede,
        r.rector, r.telefonoRector, r.correoRector,
        r.reportante, r.telefonoReportante, r.correoReportante,
        r.estudiantesNum != null ? r.estudiantesNum : '',
        unir(r.afectaciones), r.descripcionAfectaciones,
        unir(r.accionesSugeridas), unir(r.aporteDepartamento),
        formatearFecha(r.actualizado),
      ]
        .map(csvEscapar)
        .join(',')
    );
  });

  // BOM al inicio para que Excel detecte UTF-8 y no dañe las tildes/ñ.
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `acciones-inmediatas-${sufijoArchivo()}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Panel lateral: detalle de solo lectura ─────────────────

function configurarPanelDetalle() {
  document.querySelectorAll('#panelDetalle [data-role="detalle-cerrar"]').forEach((el) => {
    el.addEventListener('click', cerrarDetalle);
  });
}

function cerrarDetalle() {
  document.getElementById('panelDetalle').classList.add('oculto');
  document.getElementById('panelDetalleCuerpo').innerHTML = '';
}

function abrirDetalle(r) {
  const panel = document.getElementById('panelDetalle');
  document.getElementById('panelDetalleCuerpo').innerHTML = detalleSoloLecturaHtml(r);
  wireDetalleSoloLecturaBotones(r);
  panel.classList.remove('oculto');
}

function detalleSoloLecturaHtml(r) {
  const afectacionesHtml = (r.afectaciones || []).length
    ? `<div class="detalle-bloque"><h3>Afectaciones</h3><div class="chips-solo-lectura">${r.afectaciones.map((a) => `<span class="chip-lectura">${escaparHtml(a)}</span>`).join('')}</div></div>`
    : '';
  const accionesHtml = (r.accionesSugeridas || []).length
    ? `<div class="detalle-bloque"><h3>Acciones sugeridas</h3><ul class="detalle-lista">${r.accionesSugeridas.map((a) => `<li>${escaparHtml(a)}</li>`).join('')}</ul></div>`
    : '';
  const aporteHtml = (r.aporteDepartamento || []).length
    ? `<div class="detalle-bloque"><h3>Aporte del departamento</h3><div class="chips-solo-lectura">${r.aporteDepartamento.map((a) => `<span class="chip-lectura">${escaparHtml(a)}</span>`).join('')}</div></div>`
    : '';

  return `
    <div class="detalle-titulo">${escaparHtml(r.institucion)}</div>
    <div class="detalle-sub">${escaparHtml(r.sede)} · ${escaparHtml(r.municipio)}, ${escaparHtml(r.departamento)}</div>

    <div class="detalle-bloque">
      <h3>Reportante</h3>
      <div class="detalle-linea"><span>Nombre</span><span>${escaparHtml(r.reportante || '—')}</span></div>
      ${r.correoReportante ? `<div class="detalle-linea"><span>Correo</span><span>${escaparHtml(r.correoReportante)}</span></div>` : ''}
      ${r.telefonoReportante ? `<div class="detalle-linea"><span>Teléfono</span><span>${escaparHtml(r.telefonoReportante)}</span></div>` : ''}
    </div>

    <div class="detalle-bloque">
      <h3>Rector</h3>
      <div class="detalle-linea"><span>Nombre</span><span>${escaparHtml(r.rector || '—')}</span></div>
      ${r.telefonoRector ? `<div class="detalle-linea"><span>Teléfono</span><span>${escaparHtml(r.telefonoRector)}</span></div>` : ''}
      ${r.correoRector ? `<div class="detalle-linea"><span>Correo</span><span>${escaparHtml(r.correoRector)}</span></div>` : ''}
    </div>

    ${r.vereda ? `<div class="detalle-bloque"><h3>Vereda</h3><div class="detalle-linea"><span>Nombre</span><span>${escaparHtml(r.vereda)}</span></div></div>` : ''}

    ${r.estudiantesNum != null ? `<div class="detalle-matricula-stat">${iconoSvg('icono-personas')} <strong>${escaparHtml(r.estudiantesNum)}</strong> estudiantes</div>` : ''}

    ${afectacionesHtml}
    ${r.descripcionAfectaciones ? `<div class="detalle-bloque"><h3>Descripción</h3><div class="detalle-descripcion">${escaparHtml(r.descripcionAfectaciones)}</div></div>` : ''}
    ${accionesHtml}
    ${aporteHtml}

    <div class="detalle-acciones-panel">
      <button type="button" class="btn btn-secundario" id="btnEditarRegistro">${iconoSvg('icono-lapiz')} Editar</button>
      <button type="button" class="btn-peligro" id="btnEliminarRegistro">${iconoSvg('icono-basura')} Eliminar</button>
    </div>
  `;
}

function wireDetalleSoloLecturaBotones(r) {
  document.getElementById('btnEditarRegistro').addEventListener('click', () => abrirEdicion(r));

  const btnEliminar = document.getElementById('btnEliminarRegistro');
  let confirmando = false;
  let temporizador = null;
  btnEliminar.addEventListener('click', () => {
    if (!confirmando) {
      confirmando = true;
      btnEliminar.innerHTML = `${iconoSvg('icono-alerta')} ¿Confirmar eliminación?`;
      temporizador = setTimeout(() => {
        confirmando = false;
        btnEliminar.innerHTML = `${iconoSvg('icono-basura')} Eliminar`;
      }, 4000);
      return;
    }
    clearTimeout(temporizador);
    confirmarEliminar(r);
  });
}

async function confirmarEliminar(r) {
  try {
    await postGAS({ accion: 'eliminarRegistro', id: r.id });
    cerrarDetalle();
    await cargarDatos(modoConsolidado ? null : departamentoActivo);
  } catch (err) {
    alert('No se pudo eliminar el registro: ' + err.message);
  }
}

// ─── Panel lateral: edición ──────────────────────────────────

function previsualizarNombrePropio(inputEl) {
  const valor = inputEl.value;
  const normalizado = nombrePropio(valor);
  let previa = inputEl.nextElementSibling;
  if (!previa || !previa.classList.contains('previsualizacion')) {
    previa = document.createElement('div');
    previa.className = 'previsualizacion oculto';
    inputEl.insertAdjacentElement('afterend', previa);
  }
  if (valor.trim() && normalizado !== valor.trim()) {
    previa.textContent = '→ ' + normalizado;
    previa.classList.remove('oculto');
  } else {
    previa.classList.add('oculto');
  }
}

function abrirEdicion(r) {
  const tpl = document.getElementById('tpl-editor-sede');
  const nodo = tpl.content.firstElementChild.cloneNode(true);
  const cuerpo = document.getElementById('panelDetalleCuerpo');
  cuerpo.innerHTML = '';
  cuerpo.appendChild(nodo);

  const selDepto = nodo.querySelector('.ed-departamento');
  DEPARTAMENTOS.forEach((d) => selDepto.add(new Option(d, d)));
  selDepto.value = r.departamento;

  nodo.querySelector('.ed-municipio').value = r.municipio || '';
  nodo.querySelector('.ed-vereda').value = r.vereda || '';
  nodo.querySelector('.ed-institucion').value = r.institucion || '';
  nodo.querySelector('.ed-sede').value = r.sede || '';
  nodo.querySelector('.ed-rector').value = r.rector || '';
  nodo.querySelector('.ed-rector-telefono').value = r.telefonoRector || '';
  nodo.querySelector('.ed-rector-correo').value = r.correoRector || '';
  nodo.querySelector('.ed-reportante').value = r.reportante || '';
  nodo.querySelector('.ed-reportante-correo').value = r.correoReportante || '';
  nodo.querySelector('.ed-reportante-telefono').value = r.telefonoReportante || '';
  nodo.querySelector('.ed-estudiantes').value = r.estudiantesNum != null ? r.estudiantesNum : '';
  nodo.querySelector('.ed-descripcion').value = r.descripcionAfectaciones || '';

  (r.afectaciones || []).forEach((a) => {
    const chip = nodo.querySelector(`.ed-chips-afectacion .chip[data-valor="${cssEscape(a)}"]`);
    if (chip) chip.classList.add('activo');
  });

  const campoAccionOtra = nodo.querySelector('.campo-accion-otra');
  const inputAccionOtra = nodo.querySelector('.ed-accion-otra');
  (r.accionesSugeridas || []).forEach((a) => {
    const chip = nodo.querySelector(`.chip-accion[data-valor="${cssEscape(a)}"]`);
    if (chip) {
      chip.classList.add('activo');
    } else {
      const chipOtra = nodo.querySelector('.chip-accion[data-chip-otra]');
      if (chipOtra) chipOtra.classList.add('activo');
      campoAccionOtra.classList.remove('oculto');
      inputAccionOtra.value = a;
    }
  });

  (r.aporteDepartamento || []).forEach((a) => {
    const chip = nodo.querySelector(`.ed-chips-aporte .chip[data-valor="${cssEscape(a)}"]`);
    if (chip) chip.classList.add('activo');
  });

  configurarStepperEditor(nodo);
  configurarChipsAfectacionEditor(nodo);
  configurarChipsAccionesEditor(nodo);
  configurarChipsSimplesEditor(nodo.querySelector('.ed-chips-aporte'));

  [
    nodo.querySelector('.ed-rector'), nodo.querySelector('.ed-municipio'),
    nodo.querySelector('.ed-vereda'), nodo.querySelector('.ed-institucion'),
    nodo.querySelector('.ed-sede'), nodo.querySelector('.ed-reportante'),
  ].forEach((input) => input.addEventListener('input', () => previsualizarNombrePropio(input)));

  nodo.querySelector('.ed-cancelar').addEventListener('click', () => abrirDetalle(r));
  nodo.addEventListener('submit', (e) => {
    e.preventDefault();
    guardarEdicion(r, nodo);
  });
}

function configurarStepperEditor(nodo) {
  const input = nodo.querySelector('.ed-estudiantes');
  nodo.querySelector('.btn-restar').addEventListener('click', () => {
    input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
  });
  nodo.querySelector('.btn-sumar').addEventListener('click', () => {
    input.value = (parseInt(input.value, 10) || 0) + 1;
  });
}

function configurarChipsAfectacionEditor(nodo) {
  const contenedor = nodo.querySelector('.ed-chips-afectacion');
  contenedor.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const esSinAfectaciones = chip.hasAttribute('data-sin-afectaciones');
      if (esSinAfectaciones) {
        const activar = !chip.classList.contains('activo');
        contenedor.querySelectorAll('.chip').forEach((c) => c.classList.remove('activo'));
        if (activar) chip.classList.add('activo');
      } else {
        const chipSin = contenedor.querySelector('.chip[data-sin-afectaciones]');
        if (chipSin) chipSin.classList.remove('activo');
        chip.classList.toggle('activo');
      }
    });
  });
}

function configurarChipsAccionesEditor(nodo) {
  const campoOtra = nodo.querySelector('.campo-accion-otra');
  const inputOtra = nodo.querySelector('.ed-accion-otra');
  nodo.querySelectorAll('.chip-accion').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('activo');
      if (chip.hasAttribute('data-chip-otra')) {
        const activo = chip.classList.contains('activo');
        campoOtra.classList.toggle('oculto', !activo);
        if (activo) inputOtra.focus();
      }
    });
  });
}

function configurarChipsSimplesEditor(contenedor) {
  contenedor.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => chip.classList.toggle('activo'));
  });
}

function accionesEditorDe(nodo) {
  return [...nodo.querySelectorAll('.chip-accion.activo')]
    .map((chip) => {
      if (chip.hasAttribute('data-chip-otra')) {
        const inputOtra = nodo.querySelector('.ed-accion-otra');
        return inputOtra ? inputOtra.value.trim() : '';
      }
      return chip.dataset.valor;
    })
    .filter((v) => v);
}

function recopilarPayloadEditor(nodo) {
  return {
    reportante: {
      nombre: nodo.querySelector('.ed-reportante').value.trim(),
      correo: nodo.querySelector('.ed-reportante-correo').value.trim(),
      telefono: nodo.querySelector('.ed-reportante-telefono').value.trim(),
    },
    departamento: nodo.querySelector('.ed-departamento').value,
    municipio: nodo.querySelector('.ed-municipio').value,
    vereda: nodo.querySelector('.ed-vereda').value,
    institucion: nodo.querySelector('.ed-institucion').value,
    sede: nodo.querySelector('.ed-sede').value,
    rector: nodo.querySelector('.ed-rector').value,
    telefonoRector: nodo.querySelector('.ed-rector-telefono').value.trim(),
    correoRector: nodo.querySelector('.ed-rector-correo').value.trim(),
    numeroEstudiantes: nodo.querySelector('.ed-estudiantes').value,
    afectaciones: [...nodo.querySelectorAll('.ed-chips-afectacion .chip.activo')].map((c) => c.dataset.valor),
    descripcionAfectaciones: nodo.querySelector('.ed-descripcion').value.trim(),
    accionesSugeridas: accionesEditorDe(nodo),
    aporteDepartamento: [...nodo.querySelectorAll('.ed-chips-aporte .chip.activo')].map((c) => c.dataset.valor),
  };
}

async function guardarEdicion(r, nodo) {
  const payload = recopilarPayloadEditor(nodo);
  if (!payload.reportante.nombre || !payload.departamento || !payload.municipio || !payload.institucion || !payload.sede) {
    alert('Completa reportante, departamento, municipio, institución y sede.');
    return;
  }

  const btnGuardar = nodo.querySelector('.ed-guardar');
  btnGuardar.disabled = true;
  try {
    await postGAS({ accion: 'editarRegistro', id: r.id, ...payload });
    cerrarDetalle();
    await cargarDatos(modoConsolidado ? null : departamentoActivo);
  } catch (err) {
    alert('No se pudo guardar el cambio: ' + err.message);
    btnGuardar.disabled = false;
  }
}
