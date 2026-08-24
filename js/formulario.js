// ================================================
// FORMULARIO.JS — Acciones inmediatas por departamento
// Asistente de 3 pasos, repetidores de institución/sede (cada institución
// elige su propio municipio, así se pueden mezclar varios municipios del
// mismo departamento en un solo envío), cascada de catálogo con opción
// "otra", borrador en localStorage, "Mis reportes guardados" y envío
// secuencial sede por sede con reintento de fallidas.
// ================================================

const CLAVE_BORRADOR = 'aid_borrador_v1';
const TOTAL_PASOS = 3;
const VALOR_OTRA = '__otra__';
const COLLATOR_ES = new Intl.Collator('es', { sensitivity: 'base' });

let pasoActual = 1;
let itemsEnvioPendientes = [];
let temporizadorAutoguardadoTexto = null;

let elReportanteNombre, elReportanteCorreo, elReportanteTelefono;
let elSelectDepartamento;
let elListaInstituciones, elListaMisReportes, elBloqueMisReportes;

document.addEventListener('DOMContentLoaded', iniciar);

function iniciar() {
  elReportanteNombre = document.getElementById('reportanteNombre');
  elReportanteCorreo = document.getElementById('reportanteCorreo');
  elReportanteTelefono = document.getElementById('reportanteTelefono');
  elSelectDepartamento = document.getElementById('selectDepartamento');
  elListaInstituciones = document.getElementById('listaInstituciones');
  elListaMisReportes = document.getElementById('listaMisReportes');
  elBloqueMisReportes = document.getElementById('bloqueMisReportes');

  poblarDepartamentos();
  configurarNavegacion();
  configurarPaso1();
  configurarPasoInstituciones();

  restaurarBorrador();
  cargarReportantesConocidos();
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
  div.textContent = String(s || '');
  return div.innerHTML;
}

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
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

// ─── Paso 1 — Quién reporta ──────────────────────────────────

function poblarDepartamentos() {
  DEPARTAMENTOS.forEach((d) => elSelectDepartamento.add(new Option(d, d)));
}

function configurarPaso1() {
  elReportanteNombre.addEventListener('input', () => {
    const previa = document.getElementById('previaNombreReportante');
    const valor = elReportanteNombre.value;
    const normalizado = nombrePropio(valor);
    if (valor.trim() && normalizado !== valor.trim()) {
      previa.textContent = '→ ' + normalizado;
      previa.classList.remove('oculto');
    } else {
      previa.classList.add('oculto');
    }
    guardarBorrador();
  });
  elReportanteNombre.addEventListener('blur', () => cargarMisReportes());
  elReportanteCorreo.addEventListener('input', () => guardarBorrador());
  elReportanteTelefono.addEventListener('input', () => guardarBorrador());

  elSelectDepartamento.addEventListener('change', () => {
    actualizarBloquesInstitucionExistentes();
    guardarBorrador();
    cargarMisReportes();
  });
}

// Rellena un <select> de municipios según el departamento activo. Se usa
// por cada institución (no hay un municipio único para todo el envío: cada
// institución puede ser de un municipio distinto del mismo departamento).
function poblarMunicipiosEnSelect(selectEl, valorPrevio) {
  const depto = elSelectDepartamento.value;
  const anterior = valorPrevio !== undefined ? valorPrevio : selectEl.value;
  selectEl.innerHTML = '<option value="">— Selecciona un municipio —</option>';
  if (!depto) return;

  const municipios = depto === 'Caldas'
    ? Object.keys(CATALOGO.Caldas).sort(COLLATOR_ES.compare)
    : (MUNICIPIOS_SIN_CATALOGO[depto] || []).slice();

  municipios.forEach((m) => selectEl.add(new Option(m, m)));
  if (municipios.indexOf(anterior) !== -1) selectEl.value = anterior;
}

async function cargarReportantesConocidos() {
  if (!CONFIG.GAS_URL) return;
  try {
    const lista = await getGAS({ accion: 'reportantes' });
    const datalist = document.getElementById('listaReportantes');
    datalist.innerHTML = '';
    lista.forEach((r) => datalist.add(new Option(r.nombre)));
  } catch (err) {
    // El autocompletado es una mejora, no bloquea el formulario si falla.
  }
}

async function cargarMisReportes() {
  const nombre = elReportanteNombre.value.trim();
  if (!nombre || !CONFIG.GAS_URL) { elBloqueMisReportes.classList.add('oculto'); return; }

  try {
    const registros = await getGAS({ accion: 'misRegistros', reportante: nombre });
    if (!registros || !registros.length) { elBloqueMisReportes.classList.add('oculto'); return; }

    elListaMisReportes.innerHTML = '';
    registros.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'mis-reportes-item';
      div.innerHTML = `
        <div>
          <div class="nombre">${escaparHtml(r.institucion)} — ${escaparHtml(r.sede)}</div>
          <div class="lugar">${escaparHtml(r.departamento)}, ${escaparHtml(r.municipio)} ·
            <span class="badge-estado ${r.estado === 'Completo' ? 'completo' : 'borrador'}">${escaparHtml(r.estado)}</span>
          </div>
        </div>
        <button type="button" class="btn-texto">${iconoSvg('icono-lapiz')} Editar</button>`;
      div.querySelector('.btn-texto').addEventListener('click', () => retomarRegistro(r));
      elListaMisReportes.appendChild(div);
    });
    elBloqueMisReportes.classList.remove('oculto');
  } catch (err) {
    elBloqueMisReportes.classList.add('oculto');
  }
}

function retomarRegistro(r) {
  elSelectDepartamento.value = r.departamento;
  elListaInstituciones.innerHTML = '';
  agregarInstitucion({ municipio: r.municipio, institucion: r.institucion, sedes: [r] });
  guardarBorrador();
  mostrarPaso(2);
}

// ─── Navegación del asistente ────────────────────────────────

function configurarNavegacion() {
  document.getElementById('btnSiguiente').addEventListener('click', irSiguiente);
  document.getElementById('btnAnterior').addEventListener('click', irAnterior);
  document.getElementById('btnEnviar').addEventListener('click', enviarTodo);
}

function mostrarPaso(n) {
  for (let i = 1; i <= TOTAL_PASOS; i++) {
    document.getElementById('paso' + i).classList.toggle('oculto', i !== n);
  }
  document.querySelectorAll('.progreso-paso').forEach((el) => {
    const p = parseInt(el.dataset.paso, 10);
    el.classList.toggle('activo', p === n);
    el.classList.toggle('hecho', p < n);
  });
  document.getElementById('btnAnterior').classList.toggle('oculto', n === 1);
  document.getElementById('btnSiguiente').classList.toggle('oculto', n === TOTAL_PASOS);
  document.getElementById('btnEnviar').classList.toggle('oculto', n !== TOTAL_PASOS);
  pasoActual = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function irSiguiente() {
  if (!validarPaso(pasoActual)) return;
  if (pasoActual === 1) prepararPasoInstituciones();
  if (pasoActual === 2) renderRevision();
  if (pasoActual < TOTAL_PASOS) mostrarPaso(pasoActual + 1);
}

function irAnterior() {
  if (pasoActual > 1) mostrarPaso(pasoActual - 1);
}

function marcarError(el) { if (el) el.classList.add('control-error'); }
function limpiarErrores() { document.querySelectorAll('.control-error').forEach((el) => el.classList.remove('control-error')); }

function validarPaso(n) {
  limpiarErrores();

  if (n === 1) {
    let ok = true;
    if (!elReportanteNombre.value.trim()) { marcarError(elReportanteNombre); ok = false; }
    if (!elSelectDepartamento.value) { marcarError(elSelectDepartamento); ok = false; }
    return ok;
  }

  if (n === 2) {
    const bloques = [...elListaInstituciones.querySelectorAll('.institucion-bloque')];
    if (bloques.length === 0) {
      alert('Agrega al menos una institución educativa.');
      return false;
    }
    let ok = true;
    bloques.forEach((bi) => {
      const selectMunicipio = bi.querySelector('.select-municipio');
      if (!selectMunicipio.value) { marcarError(selectMunicipio); ok = false; }
      if (!nombreInstitucion(bi)) { marcarError(institucionControlActivo(bi)); ok = false; }
      const sedes = [...bi.querySelectorAll('.sede-bloque')];
      if (sedes.length === 0) ok = false;
      sedes.forEach((bs) => {
        if (!nombreSede(bs)) { marcarError(sedeControlActivo(bs)); ok = false; }
      });
    });
    if (!ok) alert('Revisa los campos marcados: falta el municipio, la institución o el nombre de alguna sede.');
    return ok;
  }

  return true;
}

function prepararPasoInstituciones() {
  actualizarBloquesInstitucionExistentes();
  if (elListaInstituciones.children.length === 0) agregarInstitucion();
}

// ─── Selector con opción "otra" (catálogo + escribir a mano) ─

function configurarSelectConOtra({ select, input, campoSelect, campoOtra, opciones, onCambio }) {
  if (!opciones || opciones.length === 0) {
    campoSelect.classList.add('oculto');
    campoOtra.classList.remove('oculto');
    input.required = true;
    select.required = false;
    input.oninput = () => { previsualizarNombrePropio(input); if (onCambio) onCambio(); guardarBorrador(); };
    select.onchange = null;
    return;
  }

  campoSelect.classList.remove('oculto');
  campoOtra.classList.add('oculto');
  select.innerHTML = '';
  select.add(new Option('— Selecciona —', ''));
  opciones.forEach((o) => select.add(new Option(o, o)));
  select.add(new Option('No está en la lista — escribir a mano', VALOR_OTRA));
  select.required = true;
  input.required = false;

  select.onchange = () => {
    const esOtra = select.value === VALOR_OTRA;
    campoOtra.classList.toggle('oculto', !esOtra);
    input.required = esOtra;
    select.required = !esOtra;
    if (esOtra) input.focus();
    if (onCambio) onCambio();
    guardarBorrador();
  };
  input.oninput = () => { previsualizarNombrePropio(input); guardarBorrador(); };
}

function seleccionarValorConOtra(select, input, campoSelect, campoOtra, valor) {
  if (campoSelect.classList.contains('oculto')) {
    input.value = valor;
    previsualizarNombrePropio(input);
    return;
  }
  const opcionExiste = [...select.options].some((o) => o.value === valor);
  if (opcionExiste) {
    select.value = valor;
    campoOtra.classList.add('oculto');
  } else {
    select.value = VALOR_OTRA;
    campoOtra.classList.remove('oculto');
    input.value = valor;
    previsualizarNombrePropio(input);
  }
}

function valorFinalConOtra(campoSelect, select, campoOtra, input) {
  if (campoSelect.classList.contains('oculto')) return nombrePropio(input.value);
  if (!select.value || select.value === VALOR_OTRA) return nombrePropio(input.value);
  return select.value; // ya viene normalizado del catálogo
}

function controlActivoConOtra(campoSelect, campoOtra, select, input) {
  if (campoSelect.classList.contains('oculto')) return input;
  return campoOtra.classList.contains('oculto') ? select : input;
}

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

// ─── Paso 2 — Instituciones y sedes ──────────────────────────
// Cada tarjeta de institución elige su propio municipio: así se pueden
// mezclar varios municipios del mismo departamento en un solo envío.

function configurarPasoInstituciones() {
  document.getElementById('btnAgregarInstitucion').addEventListener('click', () => agregarInstitucion());
}

function opcionesInstitucionesActuales(municipio) {
  const depto = elSelectDepartamento.value;
  if (depto !== 'Caldas' || !municipio || !CATALOGO.Caldas[municipio]) return [];
  return Object.keys(CATALOGO.Caldas[municipio]).sort(COLLATOR_ES.compare);
}

function opcionesSedesActuales(institucionBloque) {
  const depto = elSelectDepartamento.value;
  const municipio = institucionBloque.querySelector('.select-municipio').value;
  if (depto !== 'Caldas' || !municipio) return [];
  const nombreInst = nombreInstitucion(institucionBloque);
  const sedesDisponibles = (CATALOGO.Caldas[municipio] || {})[nombreInst];
  return sedesDisponibles ? sedesDisponibles.slice() : [];
}

function nombreInstitucion(bi) {
  return valorFinalConOtra(
    bi.querySelector('.campo-institucion-select'), bi.querySelector('.select-institucion'),
    bi.querySelector('.campo-institucion-otra'), bi.querySelector('.input-institucion-otra')
  );
}

function nombreSede(bs) {
  return valorFinalConOtra(
    bs.querySelector('.campo-sede-select'), bs.querySelector('.select-sede'),
    bs.querySelector('.campo-sede-otra'), bs.querySelector('.input-sede-otra')
  );
}

function institucionControlActivo(bi) {
  return controlActivoConOtra(
    bi.querySelector('.campo-institucion-select'), bi.querySelector('.campo-institucion-otra'),
    bi.querySelector('.select-institucion'), bi.querySelector('.input-institucion-otra')
  );
}

function sedeControlActivo(bs) {
  return controlActivoConOtra(
    bs.querySelector('.campo-sede-select'), bs.querySelector('.campo-sede-otra'),
    bs.querySelector('.select-sede'), bs.querySelector('.input-sede-otra')
  );
}

function renumerarInstituciones() {
  [...elListaInstituciones.querySelectorAll('.institucion-bloque')].forEach((bi, i) => {
    const municipio = bi.querySelector('.select-municipio').value;
    bi.querySelector('.numero-institucion').textContent = 'Institución ' + (i + 1) + (municipio ? ' — ' + municipio : '');
  });
}

function renumerarSedesDe(institucionBloque) {
  [...institucionBloque.querySelectorAll('.sede-bloque')].forEach((bs, i) => {
    bs.querySelector('.numero-sede').textContent = 'Sede ' + (i + 1);
  });
}

function actualizarSelectsSedeDe(institucionBloque) {
  institucionBloque.querySelector('.sedes-lista').innerHTML = '';
  agregarSede(institucionBloque);
}

// Refresca la cascada Municipio → Institución de cada tarjeta ya creada.
// Se llama al cambiar el departamento (paso 1) o al entrar al paso de
// instituciones, por si el departamento cambió después de crear tarjetas.
function actualizarBloquesInstitucionExistentes() {
  [...elListaInstituciones.querySelectorAll('.institucion-bloque')].forEach((bi) => {
    const selectMunicipio = bi.querySelector('.select-municipio');
    poblarMunicipiosEnSelect(selectMunicipio);
    refrescarInstitucionDe(bi);
    renumerarInstituciones();
  });
}

function refrescarInstitucionDe(institucionBloque) {
  const selectInst = institucionBloque.querySelector('.select-institucion');
  const inputOtra = institucionBloque.querySelector('.input-institucion-otra');
  const campoSelect = institucionBloque.querySelector('.campo-institucion-select');
  const campoOtra = institucionBloque.querySelector('.campo-institucion-otra');
  const municipio = institucionBloque.querySelector('.select-municipio').value;
  const valorActual = nombreInstitucion(institucionBloque);

  configurarSelectConOtra({
    select: selectInst, input: inputOtra, campoSelect, campoOtra,
    opciones: opcionesInstitucionesActuales(municipio),
    onCambio: () => actualizarSelectsSedeDe(institucionBloque),
  });
  if (valorActual) seleccionarValorConOtra(selectInst, inputOtra, campoSelect, campoOtra, valorActual);
}

function agregarInstitucion(datosPrevios) {
  const tpl = document.getElementById('tpl-institucion');
  const nodo = tpl.content.firstElementChild.cloneNode(true);

  const selectMunicipio = nodo.querySelector('.select-municipio');
  const selectInst = nodo.querySelector('.select-institucion');
  const inputOtra = nodo.querySelector('.input-institucion-otra');
  const campoSelect = nodo.querySelector('.campo-institucion-select');
  const campoOtra = nodo.querySelector('.campo-institucion-otra');

  poblarMunicipiosEnSelect(selectMunicipio);
  if (datosPrevios && datosPrevios.municipio) selectMunicipio.value = datosPrevios.municipio;

  configurarSelectConOtra({
    select: selectInst, input: inputOtra, campoSelect, campoOtra,
    opciones: opcionesInstitucionesActuales(selectMunicipio.value),
    onCambio: () => actualizarSelectsSedeDe(nodo),
  });

  selectMunicipio.onchange = () => {
    refrescarInstitucionDe(nodo);
    actualizarSelectsSedeDe(nodo);
    renumerarInstituciones();
    guardarBorrador();
  };

  nodo.querySelector('.btn-quitar-institucion').addEventListener('click', () => {
    nodo.remove();
    renumerarInstituciones();
    guardarBorrador();
  });
  nodo.querySelector('.btn-agregar-sede').addEventListener('click', () => { agregarSede(nodo); guardarBorrador(); });

  elListaInstituciones.appendChild(nodo);
  renumerarInstituciones();

  if (datosPrevios) {
    if (datosPrevios.institucion) {
      seleccionarValorConOtra(selectInst, inputOtra, campoSelect, campoOtra, datosPrevios.institucion);
    }
    (datosPrevios.sedes || []).forEach((s) => agregarSede(nodo, s));
  } else {
    agregarSede(nodo);
  }

  guardarBorrador();
  return nodo;
}

function agregarSede(institucionBloque, datosPrevios) {
  const tpl = document.getElementById('tpl-sede');
  const nodo = tpl.content.firstElementChild.cloneNode(true);

  const selectSede = nodo.querySelector('.select-sede');
  const inputOtra = nodo.querySelector('.input-sede-otra');
  const campoSelect = nodo.querySelector('.campo-sede-select');
  const campoOtra = nodo.querySelector('.campo-sede-otra');

  configurarSelectConOtra({
    select: selectSede, input: inputOtra, campoSelect, campoOtra,
    opciones: opcionesSedesActuales(institucionBloque),
  });

  nodo.querySelector('.btn-quitar-sede').addEventListener('click', () => {
    nodo.remove();
    renumerarSedesDe(institucionBloque);
    guardarBorrador();
  });

  configurarStepper(nodo);
  configurarChipsAfectacion(nodo);

  ['.input-vereda', '.input-rector'].forEach((sel) => {
    nodo.querySelector(sel).addEventListener('input', (e) => { previsualizarNombrePropio(e.target); guardarBorrador(); });
  });
  ['.textarea-descripcion', '.textarea-acciones'].forEach((sel) => {
    nodo.querySelector(sel).addEventListener('input', () => { guardarBorrador(); actualizarBadgeEstadoSede(nodo); });
  });

  institucionBloque.querySelector('.sedes-lista').appendChild(nodo);
  renumerarSedesDe(institucionBloque);

  if (datosPrevios) {
    if (datosPrevios.sede) seleccionarValorConOtra(selectSede, inputOtra, campoSelect, campoOtra, datosPrevios.sede);
    nodo.querySelector('.input-vereda').value = datosPrevios.vereda || '';
    nodo.querySelector('.input-rector').value = datosPrevios.rector || '';
    nodo.querySelector('.input-estudiantes').value = datosPrevios.numeroEstudiantes || '';
    nodo.querySelector('.textarea-descripcion').value = datosPrevios.descripcionAfectaciones || '';
    nodo.querySelector('.textarea-acciones').value = datosPrevios.accionesInmediatas || '';
    (datosPrevios.afectaciones || []).forEach((a) => {
      const chip = nodo.querySelector(`.chip[data-valor="${cssEscape(a)}"]`);
      if (chip) chip.classList.add('activo');
    });
    actualizarBadgeEstadoSede(nodo);
  }

  return nodo;
}

function configurarStepper(sedeBloque) {
  const input = sedeBloque.querySelector('.input-estudiantes');
  sedeBloque.querySelector('.btn-restar').addEventListener('click', () => {
    input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
    guardarBorrador();
    actualizarBadgeEstadoSede(sedeBloque);
  });
  sedeBloque.querySelector('.btn-sumar').addEventListener('click', () => {
    input.value = (parseInt(input.value, 10) || 0) + 1;
    guardarBorrador();
    actualizarBadgeEstadoSede(sedeBloque);
  });
  input.addEventListener('input', () => { guardarBorrador(); actualizarBadgeEstadoSede(sedeBloque); });
}

function configurarChipsAfectacion(sedeBloque) {
  const contenedor = sedeBloque.querySelector('.chips-afectacion');
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
      guardarBorrador();
      actualizarBadgeEstadoSede(sedeBloque);
    });
  });
}

function actualizarBadgeEstadoSede(sedeBloque) {
  const badge = sedeBloque.querySelector('.badge-estado-sede');
  if (!badge) return;
  const rector = sedeBloque.querySelector('.input-rector').value.trim();
  const estudiantes = sedeBloque.querySelector('.input-estudiantes').value;
  const afectaciones = sedeBloque.querySelectorAll('.chip.activo').length;
  const descripcion = sedeBloque.querySelector('.textarea-descripcion').value.trim();
  const acciones = sedeBloque.querySelector('.textarea-acciones').value.trim();
  const completo = !!(rector || estudiantes !== '' || afectaciones || descripcion || acciones);
  badge.textContent = completo ? 'Completo' : 'Borrador';
  badge.classList.toggle('completo', completo);
  badge.classList.toggle('borrador', !completo);
}

// ─── Recopilar datos del formulario ──────────────────────────

function recopilarInstituciones() {
  return [...elListaInstituciones.querySelectorAll('.institucion-bloque')].map((bi) => ({
    municipio: bi.querySelector('.select-municipio').value,
    institucion: nombreInstitucion(bi),
    sedes: [...bi.querySelectorAll('.sede-bloque')].map((bs) => recopilarSede(bs)),
  }));
}

function recopilarSede(bs) {
  return {
    sede: nombreSede(bs),
    vereda: nombrePropio(bs.querySelector('.input-vereda').value),
    rector: nombrePropio(bs.querySelector('.input-rector').value),
    numeroEstudiantes: bs.querySelector('.input-estudiantes').value,
    afectaciones: [...bs.querySelectorAll('.chip.activo')].map((c) => c.dataset.valor),
    descripcionAfectaciones: bs.querySelector('.textarea-descripcion').value.trim(),
    accionesInmediatas: bs.querySelector('.textarea-acciones').value.trim(),
  };
}

// ─── Borrador en localStorage ────────────────────────────────

function recopilarEstado() {
  return {
    reportante: {
      nombre: elReportanteNombre.value,
      correo: elReportanteCorreo.value,
      telefono: elReportanteTelefono.value,
    },
    departamento: elSelectDepartamento.value,
    instituciones: recopilarInstituciones(),
  };
}

const guardarBorradorDebounced = debounce(() => {
  try {
    localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(recopilarEstado()));
    mostrarIndicadorGuardado();
  } catch (err) {
    // localStorage puede fallar (privado, lleno): no es crítico para seguir llenando el formulario.
  }
}, 500);

function guardarBorrador() { guardarBorradorDebounced(); }

function mostrarIndicadorGuardado() {
  const el = document.getElementById('indicadorAutoguardado');
  const texto = document.getElementById('textoAutoguardado');
  texto.textContent = 'Guardado hace un momento';
  el.classList.remove('oculto');
  clearTimeout(temporizadorAutoguardadoTexto);
  temporizadorAutoguardadoTexto = setTimeout(() => { texto.textContent = 'Guardado en este dispositivo'; }, 3000);
}

function restaurarBorrador() {
  let datos;
  try {
    const raw = localStorage.getItem(CLAVE_BORRADOR);
    if (!raw) return;
    datos = JSON.parse(raw);
  } catch (err) {
    return;
  }
  if (!datos) return;

  elReportanteNombre.value = (datos.reportante && datos.reportante.nombre) || '';
  elReportanteCorreo.value = (datos.reportante && datos.reportante.correo) || '';
  elReportanteTelefono.value = (datos.reportante && datos.reportante.telefono) || '';

  if (datos.departamento) elSelectDepartamento.value = datos.departamento;

  (datos.instituciones || []).forEach((inst) => agregarInstitucion(inst));
}

// ─── Paso 3 — Revisión ────────────────────────────────────────

function renderRevision() {
  const datos = recopilarInstituciones();
  const contenedor = document.getElementById('listaRevision');
  const alerta = document.getElementById('alertaRevision');
  contenedor.innerHTML = '';
  alerta.innerHTML = '';

  let totalSedes = 0;
  datos.forEach((inst) => {
    inst.sedes.forEach((sede) => {
      totalSedes++;
      const div = document.createElement('div');
      div.className = 'revision-item';
      div.innerHTML = `
        <div class="titulo">${iconoSvg('icono-marcador')} ${escaparHtml(inst.municipio)} — ${escaparHtml(inst.institucion)} — ${escaparHtml(sede.sede)}</div>
        <dl>
          <dt>Vereda</dt><dd>${escaparHtml(sede.vereda) || '—'}</dd>
          <dt>Rector</dt><dd>${escaparHtml(sede.rector) || '—'}</dd>
          <dt>Estudiantes</dt><dd>${escaparHtml(sede.numeroEstudiantes) || '—'}</dd>
          <dt>Afectaciones</dt><dd>${sede.afectaciones.length ? escaparHtml(sede.afectaciones.join(', ')) : '—'}</dd>
          <dt>Descripción</dt><dd>${escaparHtml(sede.descripcionAfectaciones) || '—'}</dd>
          <dt>Acciones</dt><dd>${escaparHtml(sede.accionesInmediatas) || '—'}</dd>
        </dl>`;
      contenedor.appendChild(div);
    });
  });

  const btnEnviar = document.getElementById('btnEnviar');
  if (totalSedes === 0) {
    alerta.innerHTML = `<div class="alerta alerta-error">${iconoSvg('icono-alerta')} No hay sedes para enviar. Vuelve al paso anterior y agrega al menos una.</div>`;
    btnEnviar.disabled = true;
  } else {
    btnEnviar.disabled = false;
  }
}

// ─── Envío secuencial ─────────────────────────────────────────

async function enviarTodo() {
  const reportante = {
    nombre: elReportanteNombre.value.trim(),
    correo: elReportanteCorreo.value.trim(),
    telefono: elReportanteTelefono.value.trim(),
  };
  const departamento = elSelectDepartamento.value;
  const instituciones = recopilarInstituciones();

  const items = [];
  instituciones.forEach((inst) => {
    inst.sedes.forEach((sede) => {
      items.push({ municipio: inst.municipio, institucion: inst.institucion, ...sede, estadoEnvio: 'pendiente', error: '' });
    });
  });
  if (!items.length) return;

  document.getElementById('formulario').classList.add('oculto');
  document.getElementById('pantallaResultado').classList.remove('oculto');
  document.getElementById('indicadorAutoguardado').classList.add('oculto');

  itemsEnvioPendientes = items;
  await procesarEnvio(reportante, departamento, items);
}

async function procesarEnvio(reportante, departamento, items) {
  const listaEl = document.getElementById('listaProgresoEnvio');
  const barraEl = document.getElementById('barraGlobalRelleno');
  listaEl.innerHTML = '';

  const filas = items.map((item) => {
    const div = document.createElement('div');
    div.className = 'progreso-item';
    div.innerHTML = `<span class="estado-icono">${iconoSvg('icono-circulo')}</span><span class="nombre">${escaparHtml(item.municipio)} — ${escaparHtml(item.institucion)} — ${escaparHtml(item.sede)}</span>`;
    listaEl.appendChild(div);
    return div;
  });

  let completados = 0;
  let hubErrores = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fila = filas[i];
    fila.className = 'progreso-item activo';
    fila.querySelector('.estado-icono').innerHTML = '<div class="spinner-sm"></div>';

    try {
      await postGAS({
        accion: 'guardarRegistro',
        reportante,
        departamento,
        municipio: item.municipio,
        vereda: item.vereda,
        institucion: item.institucion,
        sede: item.sede,
        rector: item.rector,
        numeroEstudiantes: item.numeroEstudiantes,
        afectaciones: item.afectaciones,
        descripcionAfectaciones: item.descripcionAfectaciones,
        accionesInmediatas: item.accionesInmediatas,
      });
      item.estadoEnvio = 'ok';
      fila.className = 'progreso-item ok';
      fila.querySelector('.estado-icono').innerHTML = iconoSvg('icono-check-circulo');
      completados++;
    } catch (err) {
      item.estadoEnvio = 'error';
      item.error = err.message;
      hubErrores = true;
      fila.className = 'progreso-item error';
      fila.querySelector('.estado-icono').innerHTML = iconoSvg('icono-alerta');
      const detalle = document.createElement('div');
      detalle.className = 'detalle-error';
      detalle.textContent = err.message;
      fila.appendChild(detalle);
    }

    barraEl.style.transform = `scaleX(${(i + 1) / items.length})`;
  }

  mostrarResultadoFinal(completados, items.length, hubErrores, reportante, departamento);
}

function mostrarResultadoFinal(completados, total, hubErrores, reportante, departamento) {
  const iconoEl = document.getElementById('iconoResultado');
  const tituloEl = document.getElementById('tituloResultado');
  const detalleEl = document.getElementById('detalleResultado');
  const accionesEl = document.getElementById('accionesResultado');
  accionesEl.innerHTML = '';

  if (!hubErrores) {
    iconoEl.innerHTML = '<svg viewBox="0 0 24 24"><circle class="anillo-exito" cx="12" cy="12" r="9.5"/><path class="marca-exito" d="m7.5 12.5 3 3 6-6.5"/></svg>';
    tituloEl.textContent = '¡Gracias! Tu reporte quedó guardado';
    detalleEl.textContent = `Se guardaron ${completados} de ${total} sedes.`;
    try { localStorage.removeItem(CLAVE_BORRADOR); } catch (err) { /* no crítico */ }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primario';
    btn.textContent = 'Reportar otra sede';
    btn.addEventListener('click', () => location.reload());
    accionesEl.appendChild(btn);
  } else {
    iconoEl.innerHTML = '<svg viewBox="0 0 24 24"><circle class="anillo-alerta" cx="12" cy="12" r="9.5" fill="none"/><path class="marca-alerta" d="M12 7v6M12 16.2v.2" fill="none"/></svg>';
    tituloEl.textContent = 'Algunas sedes no se pudieron guardar';
    detalleEl.textContent = `Se guardaron ${completados} de ${total}. Reintenta las que fallaron.`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primario';
    btn.textContent = 'Reintentar las que fallaron';
    btn.addEventListener('click', async () => {
      const pendientes = itemsEnvioPendientes.filter((it) => it.estadoEnvio !== 'ok');
      await procesarEnvio(reportante, departamento, pendientes);
    });
    accionesEl.appendChild(btn);
  }
}
