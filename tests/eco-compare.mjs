/**
 * Comparativa del modo ahorro (gramos de laminador y rigidez de pared):
 *   node tests/eco-compare.mjs            (≈ 30 s)
 *
 * Variantes: normal · ahorro "mínimos" (mismo diseño) · ahorro "nervado"
 * ligero y rígido (piel de 3 líneas + nervios verticales; rigidez de la
 * pared de 4 líneas o de la pared normal). Gramos con los ajustes de
 * laminador de cada variante (estimate.js: perímetros, capas sólidas y
 * relleno capa a capa), no volumen macizo.
 */
import Module from 'manifold-3d';
import { init, build } from '../src/engine/engine.js';
import { cleanup } from '../src/engine/geo.js';
import { DEFAULTS, ribbedI } from '../src/engine/params.js';
import { sliceEstimate, sliceSettings, partSolid } from '../src/engine/estimate.js';

await init(Module);
const crimpPoly = [];
for (let i = 0; i <= 120; i++) { const t = i / 120, x = -95 + 190 * t; crimpPoly.push([x, x > 40 ? 27 : 12 + 4 * Math.sin(t * 20)]); }
for (let i = 120; i >= 0; i--) { const t = i / 120, x = -95 + 190 * t; crimpPoly.push([x, -(x > 40 ? 27 : 12 + 4 * Math.sin(t * 20))]); }
const BOXES = [
  ['Caja M 120×80', {}],
  ['Herramienta + organizador 6×3 + inserto', { innerL: 200, innerW: 100, baseDepth: 30, bandProud: 2.4, lidMode: 'org', orgCols: 6, orgRows: 3, orgMinL: 33, orgMinW: 32, orgDepth: 26,
    insertMode: 'pockets', contentObjects: [{ polys: [crimpPoly], notches: [[0, 30, 10]] }] }],
  ['Caja L 260×180', { innerL: 260, innerW: 180, baseDepth: 50, lidDepth: 20 }],
];
const VARIANTS = [['normal', {}], ['mínimos', { eco: true, ecoDesign: 'min' }], ['nervado ligero', { eco: true, ecoDesign: 'rib' }],
  ['nervado rígido', { eco: true, ecoDesign: 'ribStiff' }]];
const json = process.argv.includes('--json');
const out = [];
for (const [bn, b] of BOXES) {
  let ref = null;
  if (!json) console.log(`\n${bn}`);
  for (const [vn, v] of VARIANTS) {
    const r = build({ ...DEFAULTS, ...b, ...v, printAids: 'off', quality: 'preview' }, null, { normals: false });
    const D = r.D;
    let g = 0, gMac = 0, min = 0;
    const per = {};
    for (const p of r.parts) {
      const e = sliceEstimate(partSolid(p), sliceSettings(D, p, !!D.eco));
      g += e.g * p.instances.length; min += e.min * p.instances.length; gMac += p.volume * p.instances.length * 1.24 / 1000;
      per[p.id] = (per[p.id] || 0) + e.g * p.instances.length;
      cleanup();
    }
    const R = D.wallRibs;
    const I = R ? ribbedI(D.t, R.w, R.h, R.pitch) : D.t ** 3 / 12;
    if (!ref) ref = { g, I, min };
    const row = { box: bn, variant: vn, g: Math.round(g), solidG: Math.round(gMac), saving: Math.round(100 * (1 - g / ref.g)),
      h: +(min / 60).toFixed(1), time: Math.round(100 * min / ref.min),
      stiff: Math.round(100 * I / ref.I), wall: D.t, ribs: R ? `${R.n} × ${R.w}×${R.h} cada ${R.pitch}` : '—',
      parts: Object.fromEntries(Object.entries(per).map(([k, x]) => [k, Math.round(x)])), warn: D.warn.length };
    out.push(row);
    if (!json) console.log(`  ${vn.padEnd(15)} ${String(row.g).padStart(4)} g (macizo ${row.solidG}) · −${row.saving} % · ${row.h} h (${row.time} %) · pared ${row.wall} mm, rigidez ${row.stiff} % · nervios ${row.ribs} · ${Object.entries(row.parts).map(([k, x]) => `${k} ${x}`).join(' ')}`);
  }
}
if (json) console.log(JSON.stringify(out, null, 1));
