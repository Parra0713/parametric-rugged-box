/**
 * Estimador de gramos "de laminador" (src/engine/estimate.js) frente a casos
 * con solución exacta:
 *   node tests/estimate.test.mjs
 */
import Module from 'manifold-3d';
import { init } from '../src/engine/engine.js';
import { M, cleanup } from '../src/engine/geo.js';
import { sliceEstimate } from '../src/engine/estimate.js';

await init(Module);
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✔' : '  ✘'} ${msg}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const o = { lw: 0.5, lh: 0.2, perimeters: 4, topBottom: 5, infill: 0.2, density: 1 };   // 1 g/cm³: g = cm³

// Cubo macizo 20 mm: anillo de 4 perímetros (2 mm) en todas las capas,
// 5 capas sólidas arriba y abajo, el resto al 20 %.
{
  const e = sliceEstimate(M().cube([20, 20, 20]), o);
  const ring = (400 - 16 * 16) * 20 / 1000;
  const solid = 16 * 16 * 2 * 1.0 / 1000;               // 5 + 5 capas de 0.2
  const sparse = 0.2 * 16 * 16 * 18 / 1000;
  check(near(e.perimeter, ring, 0.01) && near(e.solid, solid, 0.01) && near(e.sparse, sparse, 0.01),
    `cubo: perímetros ${e.perimeter.toFixed(2)} (${ring.toFixed(2)}), sólido ${e.solid.toFixed(2)} (${solid.toFixed(2)}), relleno ${e.sparse.toFixed(2)} (${sparse.toFixed(2)})`);
}
// Pared fina de 4 líneas: todo perímetro (= volumen macizo), sin relleno.
{
  const s = M().cube([40, 40, 10]).subtract(M().cube([36, 36, 20]).translate([2, 2, 1]));
  const e = sliceEstimate(s, o);
  const vol = s.volume() / 1000;
  check(near(e.g, vol, 0.03) && e.sparse < 0.05 * e.g, `caja de pared 2 mm: ${e.g.toFixed(2)} g ≈ macizo ${vol.toFixed(2)} g`);
}
// Escalón: el techo del escalón inferior también es capa sólida.
{
  const s = M().union([M().cube([20, 20, 4]), M().cube([10, 20, 10])]);
  const e = sliceEstimate(s, { ...o, infill: 0 });
  const topOfStep = 6 * 16 * 1.0 / 1000;                 // franja 6×16 al alcance de las 5 capas del techo
  check(e.solid > topOfStep * 0.8, `escalón: el techo intermedio cuenta como sólido (${e.solid.toFixed(2)} g)`);
}
cleanup();
console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
