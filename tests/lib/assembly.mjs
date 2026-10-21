/**
 * Comprobaciones de MONTAJE REAL y de impresión sin soportes, compartidas por
 * el barrido (sweep.test.mjs) y por assembly.test.mjs.
 *
 *  1. Pasadores impresos y tapones del pasador de filamento:
 *     - en su sitio no se solapan con la base ni con la tapa (caja cerrada);
 *     - los de la bisagra tampoco chocan con la tapa al abrirla 0–180°;
 *     - se pueden COLOCAR: el tapón llega a su sitio por el eje o, si el eje
 *       está tapado, desde fuera en línea recta y luego empujándolo 2 mm; el
 *       pasador impreso entra por el lado de la cabeza;
 *     - el trozo de filamento se puede meter recto por al menos un lado.
 *  2. Piezas impresas planas: ninguna zona sin apoyo (puente o voladizo) más
 *     ancha que el puente máximo admisible (10 mm por defecto, el límite a
 *     partir del cual Orca/Bambu Studio generan soporte).
 */
import { M, CS } from '../../src/engine/geo.js';
import { overhangRegions } from '../../src/engine/tilt.js';

export const toMan = (mesh, mat) => {
  const m = new (M())({ numProp: mesh.numProp, vertProperties: mesh.vert, triVerts: mesh.tri });
  return mat ? m.transform(mat) : m;
};
const rotX = (man, deg, y, z) => man.translate([0, -y, -z]).rotate([deg, 0, 0]).translate([0, y, z]);
const vol = (a, b) => a.intersect(b).volume();

/** Ancho inscrito (2 × radio de la mayor circunferencia) de una sección 2D. */
export function inscribedWidth(cs) {
  if (cs.offset(-0.05).isEmpty()) return 0;
  let lo = 0.05, hi = 60;
  for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (cs.offset(-m).isEmpty()) hi = m; else lo = m; }
  return 2 * lo;
}

/**
 * @param r     resultado de build()
 * @param D     derive(P)
 * @param base  base cruda (marco nativo, sin z0)
 * @param lid   tapa cruda (marco nativo, sin z0)
 * @returns [{ ok, msg }]
 */
export function pinChecks(r, D, base, lid) {
  const out = [];
  const z0 = r.assembly.z0;
  const BL = base.add(lid);
  const tol = 0.05;
  const dirs = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, 0.71, 0.71], [0, -0.71, 0.71], [0, 0.71, -0.71], [0, -0.71, -0.71]];
  const sweep = (s, d, L) => M().hull([s, s.translate([d[0] * L, d[1] * L, d[2] * L])]);

  for (const pt of r.parts.filter((p) => ['cap', 'hingePin', 'latchPin'].includes(p.id))) {
    const m = toMan(pt.mesh);
    let worstFit = 0, worstOpen = 0, blocked = 0, anyHinge = false;
    pt.instances.forEach((I) => {
      const s = m.transform(I).translate([0, 0, -z0]);
      const bb = s.boundingBox();
      const cy = (bb.min[1] + bb.max[1]) / 2, cx = (bb.min[0] + bb.max[0]) / 2;
      const onHinge = Math.abs(cy - D.ya) < Math.abs(cy - D.yp);
      anyHinge ||= onHinge;
      worstFit = Math.max(worstFit, vol(s, BL));
      if (onHinge) for (let a = 15; a <= 180; a += 15) worstOpen = Math.max(worstOpen, vol(s, rotX(lid, -a, D.ya, D.za)));
      let ok;
      if (pt.id === 'cap') {
        const xs = onHinge ? D.hinge.xs : D.latch.xs;
        const xc = xs.reduce((b, x) => (Math.abs(x - cx) < Math.abs(b - cx) ? x : b), xs[0]);
        const ox = Math.sign(cx - xc) || 1;
        ok = vol(sweep(s, [ox, 0, 0], 25), BL) < tol;
        if (!ok) {
          // Fuera del extremo del filamento (sobresale 1.6 mm) y luego recto.
          const s1 = s.translate([ox * 2.2, 0, 0]);
          ok = vol(sweep(s, [ox, 0, 0], 2.2), BL) < tol && dirs.some((d) => vol(sweep(s1, d, 25), BL) < tol);
        }
      } else {
        // Pasador impreso: entra por el lado de la cabeza. Origen = cara
        // interior de la cabeza; la matriz con I[0] = −1 lo gira 180° (cabeza en +X).
        const x0 = I[12], hs = I[0] < 0 ? 1 : -1;
        const head = s.intersect(M().cube([20, 60, 60], true).translate([x0 + hs * (10 - 0.01), cy, (bb.min[2] + bb.max[2]) / 2]));
        // Recorrido de la cabeza = largo del cuerpo (la punta empieza fuera) + 1 mm.
        const hb = head.boundingBox(), hw = hb.max[0] - hb.min[0];
        ok = vol(sweep(head, [hs, 0, 0], (pt.length || 30) - hw + 1), BL) < tol;
      }
      if (!ok) blocked++;
    });
    out.push({ ok: worstFit < tol, msg: `${pt.name}: en su sitio sin solaparse con la caja (${worstFit.toFixed(3)} mm³)` });
    if (anyHinge)
      out.push({ ok: worstOpen < tol, msg: `${pt.name}: la tapa abre 0–180° sin tocarlo (${worstOpen.toFixed(3)} mm³)` });
    out.push({ ok: blocked === 0, msg: `${pt.name}: se puede colocar (${pt.instances.length - blocked}/${pt.instances.length} con camino libre)` });
  }

  // Trozo de filamento: recto por al menos un lado.
  const fil = [];
  if (D.pinMode === 'filament') for (const xc of D.hinge.xs) fil.push({ a: xc - D.hinge.len / 2, b: xc + D.hinge.len / 2, y: D.ya, z: D.za, L: r.D.filament.hinge, n: 'bisagra' });
  if (D.latchPinMode === 'filament') for (const xc of D.latch.xs) fil.push({ a: xc - D.latch.span / 2, b: xc + D.latch.span / 2, y: D.yp, z: D.zp, L: r.D.filament.latch, n: 'cierre' });
  for (const f of fil) {
    const cyl = (x0, x1) => M().cylinder(x1 - x0, 0.9, 0.9, 16).rotate([0, 90, 0]).translate([x0, f.y, f.z]);
    const left = vol(cyl(f.a - f.L - 2, f.a - 0.05), BL), right = vol(cyl(f.b + 0.05, f.b + f.L + 2), BL);
    out.push({ ok: Math.min(left, right) < tol, msg: `filamento del ${f.n} (x=${((f.a + f.b) / 2).toFixed(1)}): entra recto (izq ${left.toFixed(2)}, dcha ${right.toFixed(2)} mm³)` });
  }
  return out;
}

/**
 * Piezas planas (sin inclinar): mayor zona sin apoyo por capa.
 * @returns [{ ok, msg }]
 */
export function bridgeChecks(r, maxBridge = 10) {
  const out = [];
  for (const pt of r.parts) {
    if (pt.tilt || !['base', 'lid', 'latch', 'insert', 'insertLid'].includes(pt.id)) continue;
    const R = toMan(pt.mesh, pt.print);
    const reg = overhangRegions(R, null, { angle: 50, step: 0.2, minArea: 1 });
    let w = 0, at = 0;
    for (const x of reg) { const s = inscribedWidth(x.region); if (s > w) { w = s; at = x.z; } }
    out.push({ ok: w <= maxBridge + 0.3, msg: `${pt.name} plana: puente/voladizo más ancho ${w.toFixed(1)} mm${w ? ` a z=${at.toFixed(1)}` : ''} (máx ${maxBridge})` });
  }
  return out;
}
