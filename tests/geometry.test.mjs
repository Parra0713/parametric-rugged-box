/**
 * Pruebas geométricas (Node, sin navegador):
 *   node tests/geometry.test.mjs
 *
 * 1. Todas las piezas son mallas válidas (manifold, sin errores).
 * 2. Caja cerrada: base y tapa no se interpenetran.
 * 3. Apertura: la tapa gira 0→180° alrededor del eje de bisagra sin chocar.
 * 4. Cierres: giran 0→80° sin chocar con la base y solo tocan el retén con la
 *    precarga prevista.
 * 5. Junta TPU: compresión e índice de llenado dentro de rango.
 * Se repite para varios tamaños (clases S, M, L) y modos de sellado.
 */
import Module from 'manifold-3d';
import { init, build, _internal } from '../src/engine/engine.js';
import { DEFAULTS } from '../src/engine/params.js';

await init(Module);
const { derive, hinges, latches, buildBase, buildLid, M, cleanup } = _internal;

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✔' : '  ✘'} ${msg}`); if (!ok) fails++; };

// Rotación alrededor de un eje paralelo a X que pasa por (y, z).
function rotX(man, deg, y, z) {
  return man.translate([0, -y, -z]).rotate([deg, 0, 0]).translate([0, y, z]);
}

const cases = [
  { name: 'S 60×40 (filamento)', p: { innerL: 60, innerW: 40, baseDepth: 21, lidDepth: 9 } },
  { name: 'M 120×80 TPU', p: {} },
  { name: 'M laberinto + Gridfinity interior', p: { sealMode: 'labyrinth', gridfinity: 'baseplate', innerL: 168.5, innerW: 84.5 } },
  { name: 'M pies Gridfinity', p: { gridfinity: 'feet', innerL: 150, innerW: 100 } },
  { name: 'L 260×180×(63+27)', p: { innerL: 260, innerW: 180, baseDepth: 63, lidDepth: 27, pattern: 'cross' } },
  { name: 'M estriado relieve', p: { pattern: 'stripes', relief: 'emboss' } },
  { name: 'L plana 300×200 + radio 15', p: { innerL: 300, innerW: 200, baseDepth: 28, lidDepth: 12, innerR: 15 } },
  { name: 'Estrecha 20×172 (girada)', p: { innerL: 20, innerW: 172, baseDepth: 31, lidDepth: 3, wall: 1.2, floor: 1.2, top: 1.2, bandH: 4 } },
  { name: 'Apilable + tapa mínima + circuito', p: { stackable: true, lidMin: true, pattern: 'circuit' } },
  { name: 'Sci-fi radial grabado', p: { pattern: 'radial' } },
  { name: 'Octógono 200×120 + Gridfinity interior', p: { innerL: 200, innerW: 120, cornerCut: 25, gridfinity: 'baseplate' } },
  { name: 'Octógono + apilable + pies', p: { innerL: 160, innerW: 90, cornerCut: 15, stackable: true } },
  { name: 'Mini 30×25', p: { innerL: 30, innerW: 25, baseDepth: 15, lidDepth: 5 } },
  { name: 'Mini 35×35 tapa mínima', p: { innerL: 35, innerW: 35, baseDepth: 12, lidMin: true } },
  { name: 'XS 20×20 base 5 + tapa mínima + apilable', p: { innerL: 20, innerW: 20, baseDepth: 5, lidMin: true, stackable: true } },
  { name: 'XS 25×18 laberinto', p: { innerL: 25, innerW: 18, baseDepth: 8, lidDepth: 3, sealMode: 'labyrinth' } },
  { name: 'M + logo SVG (relleno + trazo)', p: { pattern: 'hex' }, svg: {
    fills: [{ outer: [[-20, -10], [20, -10], [20, 10], [-20, 10]], holes: [[[-5, -5], [5, -5], [5, 5], [-5, 5]]] }],
    strokes: [{ points: [[-30, -20], [0, 15], [30, -20]], width: 2 }],
  } },
];

for (const c of cases) {
  const P = { ...DEFAULTS, ...c.p };
  console.log(`\n▶ ${c.name}`);
  const t0 = performance.now();
  const res = build(P, c.svg || null);
  check(res.ok, `build en ${res.ms} ms (${Math.round(performance.now() - t0)} ms total)`);
  for (const p of res.parts) check(p.status === 'NoError' && p.tris > 0, `${p.name}: ${p.tris} tri, ${p.volume} mm³`);
  check(res.D.hinge.kl >= 4 && res.D.latchW >= 6, `mecánica mínima: nudillo ${res.D.hinge.kl} mm, cierre ${res.D.latchW} mm`);
  if (res.D.warn.length) console.log('    avisos:', res.D.warn.join(' | '));

  // Geometría cruda para colisiones (sin pies: no afectan).
  const D = derive(P);
  const H = hinges(D), L = latches(D);
  const base = buildBase(D, H, L, []);
  const lid = buildLid(D, P, H, L, c.svg || null, []).lid;

  const closed = base.intersect(lid).volume();
  check(closed < 0.05, `cerrada: interferencia base∩tapa = ${closed.toFixed(3)} mm³`);

  let worst = 0, worstA = 0;
  for (let a = 5; a <= 180; a += 5) {
    const v = base.intersect(rotX(lid, -a, D.ya, D.za)).volume();
    if (v > worst) { worst = v; worstA = a; }
  }
  check(worst < 0.05, `apertura 0–180°: peor interferencia ${worst.toFixed(3)} mm³ a ${worstA}°`);

  for (const x of D.latch.xs) {
    const latch = L.latch.translate([x, 0, 0]);
    const vb = latch.intersect(base).volume();
    const vl = latch.intersect(lid).volume();
    const expected = D.pre * (D.kd - D.kc + 0.5) * D.latchW * 1.2 + 0.5;
    check(vb < 0.05, `cierre x=${x}: ∩base = ${vb.toFixed(3)} mm³`);
    check(vl <= expected, `cierre x=${x}: ∩tapa = ${vl.toFixed(3)} mm³ (precarga, máx ${expected.toFixed(2)})`);
    let w = 0;
    for (let a = 5; a <= 80; a += 5) w = Math.max(w, rotX(latch, a, D.yp, D.zp).intersect(base).volume());
    check(w < 0.05, `cierre x=${x}: giro 0–80° sin chocar con la base (${w.toFixed(3)} mm³)`);
  }

  if (D.sealMode === 'tpu') {
    check(D.c >= 0.2 && D.c <= 0.3, `junta: compresión ${(D.c * 100).toFixed(0)} %`);
    check(D.fill <= 0.85, `junta: llenado del alojamiento ${(D.fill * 100).toFixed(0)} % (≤ 85 %)`);
  }
  console.log(`    interior: ${JSON.stringify(D.inner)}`);
  cleanup();
}

console.log(fails ? `\n✘ ${fails} comprobaciones fallidas` : '\n✔ Todas las comprobaciones superadas');
process.exit(fails ? 1 : 0);
