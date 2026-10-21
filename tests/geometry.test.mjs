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
  { name: 'S 60×40×30 (filamento)', p: { innerL: 60, innerW: 40, innerH: 30 } },
  { name: 'M 120×80×50 TPU', p: {} },
  { name: 'M laberinto + gridfinity', p: { sealMode: 'labyrinth', gridfinity: true, innerL: 150, innerW: 100 } },
  { name: 'L 260×180×90', p: { innerL: 260, innerW: 180, innerH: 90, pattern: 'cross' } },
  { name: 'M estriado relieve', p: { pattern: 'stripes', relief: 'emboss' } },
  { name: 'L plana 300×200×40 + radio 15', p: { innerL: 300, innerW: 200, innerH: 40, innerR: 15 } },
  { name: 'M con pasador de filamento forzado', p: { pinMode: 'filament', innerL: 100, innerW: 100 } },
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
  if (res.D.warn.length) console.log('    avisos:', res.D.warn.join(' | '));

  // Geometría cruda para colisiones (sin pies: no afectan).
  const D = derive(P);
  const H = hinges(D), L = latches(D);
  const base = buildBase(D, H, L);
  const lid = buildLid(D, P, H, L, c.svg || null).lid;

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
    const expected = D.pre * (D.kd - D.kc - 0.3 + 0.01) * D.latchW * 1.2 + 0.5;
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
