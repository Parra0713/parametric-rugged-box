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
 *  2. Mecánica completa: lo que bisagras y cierres tienen por fuera de la
 *     banda está ENTERO en la base y en la tapa (un recorte —p. ej. el pie
 *     de apilado— no choca con nada, así que las pruebas de colisión no lo ven).
 *  3. Piezas impresas planas: ninguna zona sin apoyo (puente o voladizo) más
 *     ancha que el puente máximo admisible (10 mm por defecto, el límite a
 *     partir del cual Orca/Bambu Studio generan soporte).
 */
import { M, CS, prism } from '../../src/engine/geo.js';
import { rrOffset } from '../../src/engine/seal.js';
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
    // Ménsula en el borde: una zona sin apoyo que llega al contorno exterior
    // de la capa no es un puente (solo apoya por un lado) y cuelga a 90°.
    // (Caso real: tapa en relieve cuyo borde quedaba a `pd` de la cama.)
    let edge = 0, edgeAt = 0;
    for (const x of reg) {
      const layer = R.slice(x.z);
      const band = layer.subtract(layer.offset(-0.6, 'Round', 2, 12));
      const a = x.region.intersect(band).area();
      if (a > edge) { edge = a; edgeAt = x.z; }
    }
    out.push({ ok: edge < 15, msg: `${pt.name} plana: sin ménsulas a 90° en el borde (${edge.toFixed(1)} mm²${edge ? ` a z=${edgeAt.toFixed(1)}` : ''})` });
  }
  return out;
}

/**
 * Mecánica completa por fuera de la banda (bisagras, orejetas, mejillas,
 * retenes). H, L = hinges(D), latches(D).
 */
export function mechChecks(D, H, L, base, lid) {
  const out = M().cube([2000, 2000, 2000], true).subtract(prism(rrOffset(D, D.F + 0.05), -500, 500));
  const mb = H.base.add(L.lugs).intersect(out).subtract(H.baseHoles).subtract(L.lugHoles).subtract(L.pockets);
  const ml = H.lid.add(L.lidCheeks).add(L.keepers).intersect(out).subtract(H.lidHoles);
  const vb = mb.subtract(base).volume(), vl = ml.subtract(lid).volume();
  const tb = mb.volume(), tl = ml.volume();
  return [
    { ok: vb <= Math.max(0.5, 0.002 * tb), msg: `base: bisagra y orejetas completas (faltan ${vb.toFixed(1)} de ${tb.toFixed(0)} mm³)` },
    { ok: vl <= Math.max(0.5, 0.002 * tl), msg: `tapa: bisagra, mejillas y retenes completos (faltan ${vl.toFixed(1)} de ${tl.toFixed(0)} mm³)` },
  ];
}

/**
 * Espesor mínimo: ninguna zona de la base o la tapa más delgada que 2 líneas
 * (0.9 mm) en cortes horizontales (cada 0.4 mm), verticales transversales
 * (plano YZ por cada cierre, sus mejillas y cada bisagra) y longitudinales
 * (plano XZ cada 0.4 mm entre la pared y el borde de la banda). Detecta membranas que se
 * transparentan y se parten (p. ej. el techo del hueco del barril bajo la
 * ranura de la junta, que medía 0.5 mm). Se ignoran las astillas de los
 * chaflanes (cuñas de < 0.5 mm² o < 1.2 mm de largo) y la cara de unión.
 */
export function thicknessChecks(D, base, lid, minW = 0.9) {
  const thinOf = (s) => {
    const open = s.offset(-minW / 2 + 0.01, 'Round', 2, 16).offset(minW / 2 - 0.01, 'Round', 2, 16);
    return s.subtract(open).offset(-0.02).offset(0.02).decompose().filter((p) => {
      const b = p.bounds();
      return p.area() >= 0.5 && Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) >= 1.2;
    });
  };
  const xs = [...D.latch.xs.flatMap((x) => [x, x - D.latchW / 2 - D.ag - D.cheekW / 2, x + D.latchW / 2 + D.ag + D.cheekW / 2]), ...D.hinge.xs];
  const res = [];
  // Bloques de pivote de las tapas interiores: la ranura de montaje tiene el
  // techo a 45° (para imprimirse sin soporte), así que sobre ella queda una
  // cuña que nace con 0.3 mm en la cara del bloque y llega a 1.2 mm al fondo.
  // Es una piel horizontal en chaflán (capas macizas), no una pared fina;
  // un corte YZ que pase justo por la ranura la ve "delgada" y no lo es.
  const grooveWedge = (name, x, zr, yr) => {
    const O = name === 'base' ? D.orgB : D.org;
    if (!O || !O.has) return false;
    const fz = (z) => (name === 'base' ? 2 * D.Hb - z : z), fy = (y) => (name === 'base' ? -y : y);
    const z = [fz(zr[0]), fz(zr[1])].sort((u, v) => u - v), y = [fy(yr[0]), fy(yr[1])].sort((u, v) => u - v);
    const gd = 1.2 - O.lip + 0.05;                      // ORG.pinE − lip
    return O.blocks.some((b) => {
      const inX = b.mid ? (x >= b.x0 - 0.01 && x <= b.x0 + gd) || (x <= b.x1 + 0.01 && x >= b.x1 - gd)
        : b.s > 0 ? x >= b.x0 - 0.01 && x <= b.x0 + gd : x <= b.x0 + 0.01 && x >= b.x0 - gd;
      return inX && z[0] >= O.zb - 0.05 && z[1] <= b.axis.z + 0.05 && y[0] >= b.axis.y - 0.3 && y[1] <= b.axis.y + O.blockR + 0.3;
    });
  };
  // La tapa incluye sus lengüetas (bajo la cara de unión). En la placa
  // Gridfinity interior el borde superior entre celdas es una arista viva por
  // norma del estándar: se excluye ese último medio milímetro.
  const gfTop = D.gfPlate ? [D.floorTop - 0.6, D.floorTop + 0.1] : null;
  for (const [name, part, z0, z1] of [['base', base, 0.3, D.Hb - 0.6], ['tapa', lid, D.Hb - D.tl + 0.3, D.Hb + D.Hl - 0.3]]) {
    const found = [];
    for (let z = z0; z < z1; z += 0.4) {
      if (name === 'base' && gfTop && z > gfTop[0] && z < gfTop[1]) continue;
      if (name === 'tapa' && Math.abs(z - D.Hb) < 0.3) continue;     // cara de unión
      for (const p of thinOf(part.slice(z))) found.push(`z=${z.toFixed(1)}`);
    }
    const R = part.rotate([0, -90, 0]);       // plano YZ: el corte en "z" es x
    for (const x of xs) for (const p of thinOf(R.slice(x))) {
      const b = p.bounds();
      const zr = [-b.max[0], -b.min[0]];        // vuelve a z de mundo
      if (name === 'base' ? zr[1] > D.Hb - 0.6 : Math.abs((zr[0] + zr[1]) / 2 - D.Hb) < 0.6) continue;   // cara de unión
      if (grooveWedge(name, x, zr, [b.min[1], b.max[1]])) continue;
      found.push(`x=${x.toFixed(1)} z ${zr[0].toFixed(1)}–${zr[1].toFixed(1)} y ${b.min[1].toFixed(1)}…${b.max[1].toFixed(1)}`);
    }
    // Cortes longitudinales (plano XZ) por la zona del cierre y de la
    // bisagra, entre la pared y el borde de la banda: una membrana corta en Y
    // pero larga en X (como el techo del hueco del barril) solo se ve aquí.
    const Q = part.rotate([90, 0, 0]);         // el corte en "z" es y; (x, −z)
    const ys = [];
    for (let k = 0.2; k <= D.bo + 0.01; k += 0.4) ys.push(-(D.sw + k), D.sw + k);
    for (const y of ys) for (const p of thinOf(Q.slice(y))) {
      const b = p.bounds();
      const zr = [-b.max[1], -b.min[1]];
      if (name === 'base' ? zr[1] > D.Hb - 0.6 : Math.abs((zr[0] + zr[1]) / 2 - D.Hb) < 0.6) continue;
      if (name === 'base' && gfTop && zr[0] > gfTop[0]) continue;
      found.push(`y=${y.toFixed(1)} z ${zr[0].toFixed(1)}–${zr[1].toFixed(1)} x ${b.min[0].toFixed(1)}…${b.max[0].toFixed(1)}`);
    }
    res.push({ ok: !found.length, msg: `${name}: sin zonas más delgadas que ${minW} mm${found.length ? ' — ' + found.slice(0, 4).join(', ') : ''}` });
  }
  return res;
}

/**
 * Ajuste de las piezas sueltas (cierre y tapones), cuyos agujeros se imprimen
 * verticales y salen más pequeños:
 *  - agujero del barril del cierre ≥ pasador + 2·holgura + compensación, con
 *    chaflán de entrada en las dos caras (la de la cama anula la pata de
 *    elefante);
 *  - tapón tipo pinza: agujero = filamento − 0.2 + compensación, ranura
 *    lateral abierta (una sola pared en C) y chaflán de entrada.
 * Diámetros medidos sobre la malla real (área del hueco en un corte).
 */
export function printFitChecks(r, D) {
  const out = [];
  const pinD = D.latchPinMode === 'filament' ? 1.75 : D.latchPinD;
  const holeDiam = (cs, cy, cz) => {
    // Hueco = disco de referencia menos material, quedándose con la pieza que contiene el centro.
    const disk = CS().circle(3 * pinD, 48).translate([cy, cz]);
    const free = disk.subtract(cs).decompose().filter((p) => p.bounds().max[0] - p.bounds().min[0] < 3 * pinD);
    const a = free.reduce((s, p) => s + p.area(), 0);
    return 2 * Math.sqrt(a / Math.PI);
  };
  const latch = r.parts.find((p) => p.id === 'latch');
  if (latch) {
    const m = toMan(latch.mesh).rotate([0, -90, 0]);     // corte en "z" = x; coordenadas (−z, y)
    const w = D.latchW;
    const at = (x) => holeDiam(m.slice(x), -D.zp, -D.sp);
    const mid = at(0), e0 = at(-w / 2 + 0.05), e1 = at(w / 2 - 0.05);
    // Holgura diametral de giro: filamento 2·filClr (1.75 → 2.0 por defecto); pasador impreso 2·clr.
    const need = pinD + (D.latchPinMode === 'filament' ? 2 * (D.filClr - D.tiltAdd) : 2 * (D.clrL - D.tiltAdd)) + D.holeComp - 0.03;
    out.push({ ok: mid >= need, msg: `cierre: agujero del barril Ø${mid.toFixed(2)} (pasador ${pinD} + holgura + compensación ≥ ${need.toFixed(2)})` });
    out.push({ ok: e0 >= mid + 0.5 && e1 >= mid + 0.5, msg: `cierre: chaflán de entrada en las dos caras (Ø${e0.toFixed(2)} / Ø${e1.toFixed(2)})` });
  }
  const cap = r.parts.find((p) => p.id === 'cap');
  if (cap) {
    const m = toMan(cap.mesh);
    const s = m.slice(1.4);
    const loops = s.toPolygons().length;
    const want = 1.75 - 0.2 + D.holeComp;
    const inner = m.intersect(M().cylinder(1.6, want / 2 - 0.02, want / 2 - 0.02, 48).translate([0, 0, 0.7])).volume();
    const wall = m.intersect(M().cylinder(1.6, want / 2 + 0.15, want / 2 + 0.15, 48).translate([0, 0, 0.7])).volume();
    // Boca: en los últimos 0.15 mm no hay material dentro de Ø(agujero + 0.4).
    const mouth = m.intersect(M().cylinder(0.15, want / 2 + 0.2, want / 2 + 0.2, 48).translate([0, 0, 2.25])).volume();
    const top = mouth < 0.01 ? want + 0.4 : want;
    out.push({ ok: loops === 1 && s.decompose().length === 1, msg: `tapón: pinza con ranura abierta (${loops} contorno/s en el corte)` });
    out.push({ ok: inner < 0.01 && wall > 0.05, msg: `tapón: agujero Ø${want.toFixed(2)} (filamento − 0.2 + compensación ${D.holeComp})` });
    out.push({ ok: top >= want + 0.4 - 1e-9, msg: `tapón: chaflán de entrada (boca Ø${top.toFixed(2)})` });
  }
  return out;
}
