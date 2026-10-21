/**
 * Pruebas del optimizador de cama: node tests/bedfit.test.mjs
 *  - Una caja larga y estrecha que no cabe en X ni en Y pero sí en diagonal
 *    debe girarse el ángulo mínimo necesario.
 *  - Una caja que no cabe ni en diagonal debe proponer una inclinación.
 */
import Module from 'manifold-3d';
import { init, build } from '../src/engine/engine.js';
import { DEFAULTS } from '../src/engine/params.js';
import { transformVerts, hull2D, fitAngle, tiltSolve, rotatedExtent } from '../src/bedfit.js';

await init(Module);
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✔' : '  ✘'} ${msg}`); if (!ok) fails++; };
const bed = { x: 220, y: 220, z: 220 };

function fitOf(P, id) {
  const r = build({ ...DEFAULTS, ...P }, null, { normals: false });
  const p = r.parts.find((q) => q.id === id);
  const xyz = transformVerts(p.mesh.vert, p.mesh.numProp, p.print);
  const hull = hull2D(xyz);
  return { hull, xyz, fit: fitAngle(hull, bed.x, bed.y) };
}

console.log('▶ Caja 120×80 (cabe recta)');
let f = fitOf({}, 'base');
check(f.fit.ok && f.fit.angle === 0, `modo ${f.fit.mode}`);

console.log('▶ Caja 225×20 (solo cabe en diagonal en 220×220)');
f = fitOf({ innerL: 225, innerW: 20, innerH: 40 }, 'base');
check(f.fit.ok && f.fit.mode === 'diagonal', `modo ${f.fit.mode}, ángulo ${f.fit.angle}°`);
const e = rotatedExtent(f.hull, f.fit.angle);
check(e.w <= bed.x && e.h <= bed.y, `huella girada ${e.w.toFixed(1)} × ${e.h.toFixed(1)} mm`);

console.log('▶ Tapa de caja 250×170 (no cabe plana)');
f = fitOf({ innerL: 250, innerW: 170, innerH: 40 }, 'lid');
check(!f.fit.ok, 'detecta que no cabe plana');
const t = tiltSolve(f.xyz, bed);
check(t.ok, `sugerencia: ${t.ok ? `inclinar ${t.alpha}° sobre ${t.axis} y girar ${t.angle}° en Z (con soportes)` : 'ninguna'}`);

console.log(fails ? `\n✘ ${fails} fallos` : '\n✔ Optimizador de cama correcto');
process.exit(fails ? 1 : 0);
