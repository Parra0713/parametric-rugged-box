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
f = fitOf({ innerL: 250, innerW: 170, baseDepth: 30, lidDepth: 10, printAids: 'off' }, 'lid');
check(!f.fit.ok, 'detecta que no cabe plana');
const t = tiltSolve(f.xyz, bed);
check(t.ok, `sugerencia: ${t.ok ? `inclinar ${t.alpha}° sobre ${t.axis} y girar ${t.angle}° en Z (con soportes)` : 'ninguna'}`);

console.log('▶ Misma tapa con ayudas automáticas (45° + corte de contacto + aletas)');
{
  const r = build({ ...DEFAULTS, innerL: 250, innerW: 170, baseDepth: 30, lidDepth: 10 }, null, { normals: false });
  const lid = r.parts.find((q) => q.id === 'lid');
  check(!!lid.tilt && lid.tilt.symmetric && lid.tilt.alpha === 45 && lid.aids.some((a) => a.name.startsWith('Aletas')), `tapa inclinada ${lid.tilt?.alpha}° con ${lid.aids.map((a) => a.name).join(' + ')}`);
  check(lid.tilt.contact * 190 >= 500, `franja de contacto ${lid.tilt.contact} mm ≈ ${Math.round(lid.tilt.contact * 190)} mm² (corte ${lid.tilt.cut} mm)`);
  check(lid.tilt.finVol < 0.15 * lid.tilt.wedgeVol, `aletas ${lid.tilt.finVol} mm³ vs cuña ${lid.tilt.wedgeVol} mm³ (${Math.round(100 * lid.tilt.finVol / lid.tilt.wedgeVol)} %)`);
  const xyz = transformVerts(lid.mesh.vert, lid.mesh.numProp, lid.print);
  let zmin = Infinity; for (let i = 2; i < xyz.length; i += 3) zmin = Math.min(zmin, xyz[i]);
  const ff = fitAngle(hull2D(xyz), bed.x - 4, bed.y - 4);
  check(ff.ok && Math.abs(zmin) < 0.01, `cabe tras inclinar (${ff.mode}), apoyada en z=0`);
}

console.log('▶ Optimizador: caja larga que solo cabe plana recortando esquinas');
{
  const { optimize } = await import('../src/optimizer.js');
  const P = { ...DEFAULTS, innerL: 250.5, innerW: 46 };
  const o = optimize(P, 11.5);
  check(o.status === 'option' && o.best.P.cornerCut > 0 && o.best.P.cornerCut <= 11.5, `propone ${o.best?.changes.join(' + ')}`);
  const r = build({ ...o.best.P, printAids: 'off' }, null, { normals: false });
  const base = r.parts.find((q) => q.id === 'base');
  const ff = fitAngle(hull2D(transformVerts(base.mesh.vert, base.mesh.numProp, base.print)), bed.x - 4, bed.y - 4);
  check(ff.ok, `la geometría real cabe plana tras aplicarlo (${ff.mode} ${ff.angle}°)`);
}

console.log(fails ? `\n✘ ${fails} fallos` : '\n✔ Optimizador de cama correcto');
process.exit(fails ? 1 : 0);
