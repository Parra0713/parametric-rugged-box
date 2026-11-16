/**
 * Presupuestos de rendimiento por función (Node):
 *   node tests/budget.test.mjs              comprobar
 *   node tests/budget.test.mjs --update     guardar la línea base actual
 *   node tests/budget.test.mjs --filter=org solo las funciones que coincidan
 *
 * Mide, para cada función de la caja, lo que el usuario nota al editar:
 *   · vista rápida  = max(hilo A, hilo B) en calidad 'draft' tras un cambio
 *                     que invalida todas las cachés (medida interior);
 *   · cambio de tapa = lo mismo cambiando un parámetro "solo tapa": el hilo A
 *                     debe salir de la caché (casi gratis);
 *   · cambio de contenido = tolerancia del inserto: la tapa sale de su caché
 *                     y solo se rehace el inserto (si lo hay);
 *   · modelo completo = build() en calidad 'preview' (hilo R).
 *
 * Los tiempos se normalizan con una carga de referencia fija (operaciones de
 * manifold que no dependen del código de la caja), de modo que la misma línea
 * base sirve en otra máquina más rápida o más lenta.
 *
 * Falla si:
 *   1. alguna medida supera su PRESUPUESTO absoluto (en ms de la máquina de
 *      referencia: lo que se considera "tiempo real" para esa función), o
 *   2. empeora más de un 50 % (y más de 25 ms) frente a la línea base guardada
 *      en tests/perf-baseline.json.
 *
 * REGLA: cada función nueva añade su entrada en FEATURES (con su
 * presupuesto) y se ejecuta `--update` en el mismo commit.
 */
import Module from 'manifold-3d';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { init, build } from '../src/engine/engine.js';
import { DEFAULTS } from '../src/engine/params.js';

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const FILTER = (args.find((a) => a.startsWith('--filter=')) || '').slice(9);
const BASE_FILE = new URL('./perf-baseline.json', import.meta.url);

const wasm = await Module();
wasm.setup();
await init(Module);

/* Carga de referencia --------------------------------------------- */
// Velocidad de la máquina: booleanas y teselado de manifold puro. 1.0 = la
// máquina donde se fijaron los presupuestos (≈ 60 ms esta carga).
const REF_MS = 60;
function refLoad() {
  const { Manifold, CrossSection } = wasm;
  const t0 = performance.now();
  let acc = Manifold.cube([40, 40, 20], true);
  for (let i = 0; i < 12; i++) {
    const c = Manifold.cylinder(30, 3 + i * 0.1, 3 + i * 0.1, 48).translate([-15 + i * 2.7, (i % 3) * 8 - 8, -15]);
    acc = acc.subtract(c);
  }
  const cs = CrossSection.circle(18, 96).offset(-1, 'Round', 2, 64);
  acc = acc.add(cs.extrude(25).translate([0, 0, -12]));
  const m = acc.getMesh();
  const n = m.numTri;
  acc.delete(); cs.delete();
  return { ms: performance.now() - t0, n };
}
for (let i = 0; i < 3; i++) refLoad();           // calentar
const refs = Array.from({ length: 7 }, () => refLoad().ms).sort((a, b) => a - b);
const speed = refs[3] / REF_MS;                   // > 1: máquina más lenta
console.log(`Carga de referencia: ${refs[3].toFixed(1)} ms → factor de máquina ×${speed.toFixed(2)}`);

/* Funciones -------------------------------------------------------- */
// Contorno tipo herramienta (≈ 190 × 55 mm, muchos vértices).
const crimpPoly = [];
for (let i = 0; i <= 120; i++) { const t = i / 120, x = -95 + 190 * t; crimpPoly.push([x, x > 40 ? 27 : 12 + 4 * Math.sin(t * 20)]); }
for (let i = 120; i >= 0; i--) { const t = i / 120, x = -95 + 190 * t; crimpPoly.push([x, -(x > 40 ? 27 : 12 + 4 * Math.sin(t * 20))]); }
const CRIMP = { innerL: 200, innerW: 100, baseDepth: 30, bandProud: 2.4, lidMode: 'org', orgCols: 6, orgRows: 3, orgMinL: 33, orgMinW: 32, orgDepth: 26,
  insertMode: 'pockets', contentObjects: [{ polys: [crimpPoly], notches: [[0, 30, 10]] }] };

// [nombre, parámetros, presupuesto { draft, lid, preview } en ms de referencia]
// draft ≈ "tiempo real" al arrastrar un control; preview = cuando se suelta.
const FEATURES = [
  ['caja por defecto', {}, { draft: 150, lid: 120, preview: 700 }],
  ['XS 25×25', { innerL: 25, innerW: 25, baseDepth: 12, lidDepth: 5 }, { draft: 120, lid: 100, preview: 500 }],
  ['grande inclinada', { innerL: 260, innerW: 180, baseDepth: 63, lidDepth: 27, pattern: 'cross' }, { draft: 300, lid: 250, preview: 4000 }],
  ['apilable', { stackable: true }, { draft: 200, lid: 160, preview: 900 }],
  ['octógono', { cornerCut: 15, innerL: 160, innerW: 90 }, { draft: 200, lid: 160, preview: 900 }],
  ['patrón hex + relieve', { pattern: 'hex', relief: 'emboss' }, { draft: 200, lid: 160, preview: 900 }],
  ['laberinto + tapa mínima', { sealMode: 'labyrinth', lidMin: true }, { draft: 150, lid: 120, preview: 700 }],
  ['pasadores impresos', { pinMode: 'printed', latchPinMode: 'printed' }, { draft: 180, lid: 150, preview: 800 }],
  ['Gridfinity', { gridfinity: 'baseplate', innerL: 168.5, innerW: 84.5 }, { draft: 250, lid: 150, preview: 1000 }],
  ['inserto en blanco + tapa', { insertMode: 'blank', lidMode: 'blank' }, { draft: 200, lid: 160, preview: 900 }],
  ['inserto con alojamiento', { ...CRIMP, lidMode: 'off' }, { draft: 250, lid: 160, preview: 1500 }],
  ['organizador tapa única', { lidMode: 'org', orgCols: 4, orgRows: 2 }, { draft: 250, lid: 250, preview: 1200 }],
  ['organizador por celda', { lidMode: 'org', orgCols: 4, orgRows: 2, orgCover: 'cell' }, { draft: 300, lid: 300, preview: 1500 }],
  ['herramienta completa', CRIMP, { draft: 350, lid: 300, preview: 2500 }],
  ['ahorro de material', { eco: true }, { draft: 150, lid: 120, preview: 700 }],
  ['ahorro + herramienta', { ...CRIMP, eco: true }, { draft: 350, lid: 300, preview: 2500 }],
  ['ahorro nervado', { eco: true, ecoDesign: 'rib' }, { draft: 170, lid: 140, preview: 800 }],
  ['nervado + herramienta', { ...CRIMP, eco: true, ecoDesign: 'rib' }, { draft: 380, lid: 330, preview: 2700 }],
  ['nervado rígido + herramienta', { ...CRIMP, eco: true, ecoDesign: 'ribStiff' }, { draft: 400, lid: 350, preview: 2800 }],
  // v7.3 — contenido en cualquier mitad, traba magnética, junta de cordón.
  ['compartimentos en la base', { innerL: 140, innerW: 90, baseDepth: 40, insertMode: 'org', orgBCols: 4, orgBRows: 2 }, { draft: 250, lid: 250, preview: 1200 }],
  ['compartimentos base + tapa', { innerL: 150, innerW: 100, baseDepth: 40, lidDepth: 22, insertMode: 'org', orgBCols: 3, orgBRows: 2, orgBCover: 'row', lidMode: 'org', orgCols: 3, orgRows: 2, orgCover: 'row' }, { draft: 300, lid: 300, preview: 1800 }],
  ['traba magnética por fila', { lidMode: 'org', orgCols: 4, orgRows: 2, orgCover: 'row', orgLatch: 'magnet' }, { draft: 300, lid: 300, preview: 1500 }],
  ['herramienta + imanes por celda', { ...CRIMP, orgCover: 'cell', orgLatch: 'magnet' }, { draft: 650, lid: 650, preview: 4500 }],
  ['huecos en la tapa', { ...CRIMP, lidMode: 'pockets', lidDepth: 20 }, { draft: 300, lid: 250, preview: 2000 }],
  ['junta de cordón', { sealMode: 'cord' }, { draft: 150, lid: 120, preview: 700 }],
];

/* Medición --------------------------------------------------------- */
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const time = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };

function measure(p) {
  const P0 = { ...DEFAULTS, ...p };
  const L0 = P0.innerL, W0 = P0.innerW;
  // Calentar (primera construcción de esta familia de piezas).
  build({ ...P0, quality: 'draft' }, null, { only: 'A' }); build({ ...P0, quality: 'draft' }, null, { only: 'B' });
  const draft = [], lid = [], cont = [], preview = [];
  for (let i = 1; i <= 3; i++) {
    // Cambio que invalida todo: medida interior.
    const P = { ...P0, quality: 'draft', innerW: W0 + i * 0.3 };
    const a = time(() => build(P, null, { only: 'A' }));
    const b = time(() => build(P, null, { only: 'B' }));
    draft.push(Math.max(a, b));
    // Cambio "solo tapa": profundidad de la tapa (base en caché).
    const Q = { ...P, lidDepth: (P.lidDepth || DEFAULTS.lidDepth) + 0.5 * i };
    const a2 = time(() => build(Q, null, { only: 'A' }));
    const b2 = time(() => build(Q, null, { only: 'B' }));
    lid.push(Math.max(a2, b2));
    // Cambio de contenido/inserto: la tapa sale de su caché.
    const R = { ...Q, insertTol: (DEFAULTS.insertTol ?? 0.3) + 0.05 * i };
    const a3 = time(() => build(R, null, { only: 'A' }));
    const b3 = time(() => build(R, null, { only: 'B' }));
    cont.push(Math.max(a3, b3));
  }
  for (let i = 1; i <= 2; i++) preview.push(time(() => build({ ...P0, quality: 'preview', innerL: L0 + i * 0.3 }, null)));
  // Normalizado a la máquina de referencia.
  const n = (v) => Math.round(v / speed);
  return { draft: n(med(draft)), lid: n(med(lid)), cont: n(med(cont)), preview: n(Math.min(...preview)) };
}

const baseline = existsSync(BASE_FILE) ? JSON.parse(readFileSync(BASE_FILE, 'utf8')) : {};
const out = UPDATE ? { ...baseline } : null;
let fails = 0;
const LABEL = { draft: 'vista rápida', lid: 'cambio de tapa', cont: 'cambio de contenido', preview: 'modelo completo' };
const KEYS = Object.keys(LABEL);

console.log('\nPresupuestos (ms normalizados · presupuesto · línea base)');
for (let [name, p, budget] of FEATURES) {
  if (FILTER && !name.includes(FILTER)) continue;
  const m = measure(p);
  const base = baseline[name];
  const bad = [];
  budget = { cont: Math.round(budget.draft / 2), ...budget };
  for (const k of KEYS) {
    if (m[k] > budget[k]) bad.push(`${LABEL[k]} ${m[k]} > presupuesto ${budget[k]}`);
    if (base?.[k] != null && !UPDATE &&m[k] > base[k] * 1.5 && m[k] - base[k] > 25) bad.push(`${LABEL[k]} empeora ${base[k]} → ${m[k]}`);
  }
  const fmt = (k) => `${m[k]}/${budget[k]}${base?.[k] != null ? ` (${base[k]})` : ''}`;
  console.log(`${bad.length ? '  ✘' : '  ✔'} ${name.padEnd(26)} rápida ${fmt('draft').padEnd(15)} tapa ${fmt('lid').padEnd(15)} contenido ${fmt('cont').padEnd(14)} completo ${fmt('preview')}${bad.length ? '\n      ' + bad.join(' · ') : ''}`);
  if (bad.length) fails++;
  if (out) out[name] = m;
}

if (out) {
  writeFileSync(BASE_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nLínea base guardada en tests/perf-baseline.json`);
}
console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
