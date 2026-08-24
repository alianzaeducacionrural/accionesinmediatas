#!/usr/bin/env node
// ================================================
// generar-catalogo.mjs — corre UNA vez
// ================================================
// Lee los 3 CSV de Caldas (municipios/instituciones/sedes, dump de Supabase
// de "La Universidad en el Campo") y produce js/catalogo.js: un árbol
// Municipio -> Institución -> [Sedes], con nombres ya normalizados a
// "Nombre Propio" (los CSV traen conectores en mayúscula, p. ej.
// "Alto De La Montaña" -> "Alto de la Montaña").
//
// Uso:  node tools/generar-catalogo.mjs
//
// Si el catálogo de Caldas cambia, se vuelve a correr este script — no se
// edita js/catalogo.js a mano.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { nombrePropio } from '../js/texto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const ORIGEN = path.resolve(
  RAIZ,
  '..',
  'La Universidad en el Campo'
);

function parseCsv(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').replace(/^﻿/, '').trim().split('\n');
  const encabezados = lineas[0].split(',');
  return lineas.slice(1).map((linea) => {
    const valores = linea.split(',');
    const fila = {};
    encabezados.forEach((h, i) => (fila[h] = valores[i]));
    return fila;
  });
}

function leerCsv(nombreArchivo) {
  const ruta = path.join(ORIGEN, nombreArchivo);
  const texto = readFileSync(ruta, 'utf-8');
  return parseCsv(texto);
}

const municipiosRaw = leerCsv('municipios_rows.csv');
const institucionesRaw = leerCsv('instituciones.csv');
const sedesRaw = leerCsv('sedes.csv');

const municipiosPorId = new Map(municipiosRaw.map((m) => [m.id, m]));
const institucionesPorId = new Map(institucionesRaw.map((i) => [i.id, i]));

// municipio nombre -> { institucion nombre -> [sede nombre, ...] }
const arbol = {};

for (const inst of institucionesRaw) {
  if (inst.activo !== 'true') continue;
  const mun = municipiosPorId.get(inst.municipio_id);
  if (!mun || mun.activo !== 'true') continue;
  const nombreMun = nombrePropio(mun.nombre);
  const nombreInst = nombrePropio(inst.nombre);
  if (!arbol[nombreMun]) arbol[nombreMun] = {};
  if (!arbol[nombreMun][nombreInst]) arbol[nombreMun][nombreInst] = [];
}

for (const sede of sedesRaw) {
  if (sede.activo !== 'true') continue;
  const inst = institucionesPorId.get(sede.institucion_id);
  if (!inst || inst.activo !== 'true') continue;
  const mun = municipiosPorId.get(inst.municipio_id);
  if (!mun || mun.activo !== 'true') continue;
  const nombreMun = nombrePropio(mun.nombre);
  const nombreInst = nombrePropio(inst.nombre);
  const nombreSede = nombrePropio(sede.nombre);
  if (!arbol[nombreMun]) arbol[nombreMun] = {};
  if (!arbol[nombreMun][nombreInst]) arbol[nombreMun][nombreInst] = [];
  arbol[nombreMun][nombreInst].push(nombreSede);
}

// Ordenar municipios, instituciones y sedes alfabéticamente (localeCompare
// en español para que las tildes ordenen bien).
const collator = new Intl.Collator('es', { sensitivity: 'base' });
const arbolOrdenado = {};
for (const mun of Object.keys(arbol).sort(collator.compare)) {
  arbolOrdenado[mun] = {};
  for (const inst of Object.keys(arbol[mun]).sort(collator.compare)) {
    arbolOrdenado[mun][inst] = [...arbol[mun][inst]].sort(collator.compare);
  }
}

const totalMunicipios = Object.keys(arbolOrdenado).length;
const totalInstituciones = Object.values(arbolOrdenado).reduce(
  (acc, insts) => acc + Object.keys(insts).length,
  0
);
const totalSedes = Object.values(arbolOrdenado).reduce(
  (acc, insts) =>
    acc + Object.values(insts).reduce((a, sedes) => a + sedes.length, 0),
  0
);

// --- Municipios de los otros 3 departamentos (solo nombre, lista DANE) ---
// Institución, sede y vereda se escriben a mano en estos departamentos.
const MUNICIPIOS_RISARALDA = [
  'Apía', 'Balboa', 'Belén de Umbría', 'Dosquebradas', 'Guática',
  'La Celia', 'La Virginia', 'Marsella', 'Mistrató', 'Pereira',
  'Pueblo Rico', 'Quinchía', 'Santa Rosa de Cabal', 'Santuario',
].sort(collator.compare);

const MUNICIPIOS_QUINDIO = [
  'Armenia', 'Buenavista', 'Calarcá', 'Circasia', 'Córdoba', 'Filandia',
  'Génova', 'La Tebaida', 'Montenegro', 'Pijao', 'Quimbaya', 'Salento',
].sort(collator.compare);

const MUNICIPIOS_VALLE = [
  'Alcalá', 'Andalucía', 'Ansermanuevo', 'Argelia', 'Bolívar',
  'Buenaventura', 'Buga', 'Bugalagrande', 'Caicedonia', 'Cali', 'Calima',
  'Candelaria', 'Cartago', 'Dagua', 'El Águila', 'El Cairo', 'El Cerrito',
  'El Dovio', 'Florida', 'Ginebra', 'Guacarí', 'Jamundí', 'La Cumbre',
  'La Unión', 'La Victoria', 'Obando', 'Palmira', 'Pradera', 'Restrepo',
  'Riofrío', 'Roldanillo', 'San Pedro', 'Sevilla', 'Toro', 'Trujillo',
  'Tuluá', 'Ulloa', 'Versalles', 'Vijes', 'Yotoco', 'Yumbo', 'Zarzal',
].sort(collator.compare);

const salida = `// ================================================
// CATALOGO.JS — generado por tools/generar-catalogo.mjs, no editar a mano
// ================================================
// Fuente Caldas: Plataformas/La Universidad en el Campo/
//   municipios_rows.csv, instituciones.csv, sedes.csv (dump de Supabase)
// Nombres ya normalizados con nombrePropio(). Si el catálogo cambia,
// se vuelve a correr el script generador — no se edita este archivo a mano.
//
// Caldas: ${totalMunicipios} municipios, ${totalInstituciones} instituciones, ${totalSedes} sedes.

const CATALOGO = {
  Caldas: ${JSON.stringify(arbolOrdenado, null, 2).replace(/\n/g, '\n  ')},
};

// Los demás departamentos no tienen catálogo de instituciones/sedes propio
// todavía: solo la lista de municipios. Institución, sede y vereda se
// escriben a mano en el formulario para estos tres.
const MUNICIPIOS_SIN_CATALOGO = {
  Risaralda: ${JSON.stringify(MUNICIPIOS_RISARALDA, null, 2).replace(/\n/g, '\n  ')},
  Quindío: ${JSON.stringify(MUNICIPIOS_QUINDIO, null, 2).replace(/\n/g, '\n  ')},
  'Valle del Cauca': ${JSON.stringify(MUNICIPIOS_VALLE, null, 2).replace(/\n/g, '\n  ')},
};

const DEPARTAMENTOS = ['Caldas', 'Risaralda', 'Quindío', 'Valle del Cauca'];
`;

const destino = path.join(RAIZ, 'js', 'catalogo.js');
writeFileSync(destino, salida, 'utf-8');

console.log(`OK -> ${destino}`);
console.log(`Caldas: ${totalMunicipios} municipios, ${totalInstituciones} instituciones, ${totalSedes} sedes.`);
