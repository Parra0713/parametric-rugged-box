/**
 * Compartimentos (organizador) en la tapa y/o en la base (Node):
 *   node tests/organizer.test.mjs
 *
 * Para cada configuración (tapa única / por fila / por celda / sin tapa,
 * cajas XS a L, octógono, apilable, girada, inclinada; en la tapa, en la
 * base o en las dos; traba de clic o magnética):
 *  1. Piezas válidas de un solo sólido; celdas ≥ el mínimo pedido (la caja
 *     crece si hace falta) y altura de celda ≥ la pedida.
 *  2. Cerrada: las tapas interiores no se solapan con su mitad, con la otra
 *     mitad ni entre sí (la caja cierra con los compartimentos llenos).
 *  3. Cada tapa interior abre 0–95° sobre su eje sin chocar.
 *  4. Bisagra de pivotes: eje Ø3 < agujero (gira), cada pivote entra
 *     `pinE` en un agujero CERRADO; la ranura de montaje deja un retén
 *     (`lip`) y el camino de montaje (deslizar hacia −Y) solo roza en ese
 *     retén. Faldón con la holgura calibrada y resalte con interferencia.
 *  7. Apertura: pozo para el dedo libre (sin tapa ni tapa encima) y pestaña
 *     de la tapa interior sobre su primera mitad.
 *  8. Divisores, carriles y pilares de imán separados de la pared exterior.
 *  9. Traba magnética: alojamientos del diámetro y alto pedidos en el cuerpo
 *     y en la tapa interior, cara con cara (0,4 mm), con nervios de
 *     aplastamiento, piel bajo el imán y sin resaltes de clic.
 *  5. Imprimibles sin soportes: tapas interiores sin voladizos > 50°; la
 *     mitad con compartimentos no gana voladizos. Caben en la cama.
 *  6. Sin piezas sueltas: no se añaden pasadores ni tapones.
 *
 * Los compartimentos de la base son los de la tapa girados 180° (orgFlip):
 * la prueba lleva la base y sus tapas interiores al "marco de tapa" con ese
 * mismo giro y comprueba exactamente lo mismo.
 */
import Module from 'manifold-3d';
import { init, build } from '../src/engine/engine.js';
import { DEFAULTS } from '../src/engine/params.js';
import { M, CS, prism } from '../src/engine/geo.js';
import { rrOffset } from '../src/engine/seal.js';
import { ORG, MAG } from '../src/engine/orgLayout.js';
import { transformVerts, hull2D, fitAngle } from '../src/bedfit.js';

await init(Module);
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✔' : '  ✘'} ${msg}`); if (!ok) fails++; };
const toMan = (mesh, mat) => { const m = new (M())({ numProp: mesh.numProp, vertProperties: mesh.vert, triVerts: mesh.tri }); return mat ? m.transform(mat) : m; };
const rotX = (m, deg, y, z) => m.translate([0, -y, -z]).rotate([deg, 0, 0]).translate([0, y, z]);

function steepOverhang(p) {
  const xyz = transformVerts(p.mesh.vert, p.mesh.numProp, p.print);
  const t = p.mesh.tri; let a = 0;
  for (let i = 0; i < t.length; i += 3) {
    const A = t[i] * 3, B = t[i + 1] * 3, C = t[i + 2] * 3;
    const ux = xyz[B] - xyz[A], uy = xyz[B + 1] - xyz[A + 1], uz = xyz[B + 2] - xyz[A + 2];
    const wx = xyz[C] - xyz[A], wy = xyz[C + 1] - xyz[A + 1], wz = xyz[C + 2] - xyz[A + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz); if (!l) continue;
    if (Math.min(xyz[A + 2], xyz[B + 2], xyz[C + 2]) < 0.05) continue;
    const cz = nz / l;
    if (cz > -0.999 && cz < -Math.sin((50 * Math.PI) / 180) - 1e-3) a += l / 2;
  }
  return a;
}

const user = { innerL: 205, innerW: 100, baseDepth: 30, lidDepth: 15, orgCols: 6, orgRows: 3, orgMinL: 33, orgMinW: 32, orgDepth: 26 };
// [nombre, parámetros (como si fuera en la tapa), lado: 'lid' | 'base' | 'both', extra]
const cases = [
  ['herramienta · una tapa', { ...user, orgCover: 'single' }],
  ['herramienta · por fila', { ...user, orgCover: 'row' }],
  ['herramienta · por celda', { ...user, orgCover: 'cell' }],
  ['herramienta · sin tapa', { ...user, orgCover: 'none' }],
  ['S 60×40 · 3×2 por celda', { innerL: 60, innerW: 40, baseDepth: 21, lidDepth: 12, orgCols: 3, orgRows: 2, orgCover: 'cell' }],
  ['XS 40×30 · 2×1 una tapa', { innerL: 40, innerW: 30, baseDepth: 15, lidDepth: 10, orgCols: 2, orgRows: 1, orgCover: 'single' }],
  ['M octógono · 5×3 por fila', { innerL: 160, innerW: 90, cornerCut: 15, orgCols: 5, orgRows: 3, orgCover: 'row' }],
  ['M octógono · 4×2 por celda (pozos de las esquinas)', { innerL: 160, innerW: 100, cornerCut: 14, lidDepth: 22, orgCols: 4, orgRows: 2, orgCover: 'cell' }],
  ['M apilable + girada · 2×4 una tapa', { innerL: 80, innerW: 140, stackable: true, orgCols: 2, orgRows: 4, orgCover: 'single' }],
  ['L inclinada · 6×4 por celda', { innerL: 230, innerW: 160, baseDepth: 40, lidDepth: 30, orgCols: 6, orgRows: 4, orgCover: 'cell' }],
  // Traba magnética (imanes de disco).
  ['herramienta · una tapa · imanes 6×2', { ...user, orgCover: 'single', orgLatch: 'magnet' }],
  ['herramienta · por fila · imanes 6×2', { ...user, orgCover: 'row', orgLatch: 'magnet' }],
  ['herramienta · por celda · imanes 6×2', { ...user, orgCover: 'cell', orgLatch: 'magnet' }],
  ['M · 3×2 por celda · imanes 8×3', { innerL: 150, innerW: 100, lidDepth: 22, orgCols: 3, orgRows: 2, orgCover: 'cell', orgLatch: 'magnet', magnetD: 8, magnetH: 3 }],
  ['M octógono · 4×2 por fila · imanes 5×1', { innerL: 160, innerW: 90, cornerCut: 15, lidDepth: 20, orgCols: 4, orgRows: 2, orgCover: 'row', orgLatch: 'magnet', magnetD: 5, magnetH: 1 }],
  ['S · 2×2 una tapa · imanes 4×0,8 (sin resalte)', { innerL: 80, innerW: 60, lidDepth: 14, orgCols: 2, orgRows: 2, orgCover: 'single', orgLatch: 'magnet', magnetD: 4, magnetH: 0.8 }],
  // En la base (mismo organizador, girado) y en las dos mitades.
  ['BASE · M 4×2 una tapa', { innerL: 140, innerW: 90, baseDepth: 40, orgCols: 4, orgRows: 2, orgCover: 'single' }, 'base'],
  ['BASE · M 4×3 por fila', { innerL: 150, innerW: 110, baseDepth: 35, orgCols: 4, orgRows: 3, orgCover: 'row' }, 'base'],
  ['BASE · herramienta por celda', { ...user, baseDepth: 30, orgCover: 'cell' }, 'base'],
  ['BASE · apilable + Gridfinity (pies) · 3×2 por fila', { innerL: 126, innerW: 84, baseDepth: 40, stackable: true, orgCols: 3, orgRows: 2, orgCover: 'row' }, 'base'],
  ['BASE · octógono 4×2 por celda · imanes 6×2', { innerL: 160, innerW: 100, cornerCut: 14, baseDepth: 38, orgCols: 4, orgRows: 2, orgCover: 'cell', orgLatch: 'magnet' }, 'base'],
  ['BASE · sin tapa (bandeja de celdas)', { innerL: 120, innerW: 80, baseDepth: 30, orgCols: 3, orgRows: 2, orgCover: 'none' }, 'base'],
  ['LAS DOS · M 3×2 por fila + imanes', { innerL: 150, innerW: 100, baseDepth: 40, lidDepth: 22, orgCols: 3, orgRows: 2, orgCover: 'row', orgLatch: 'magnet' }, 'both'],
  ['LAS DOS · S 2×2 por celda (clic)', { innerL: 90, innerW: 70, baseDepth: 28, lidDepth: 18, orgCols: 2, orgRows: 2, orgCover: 'cell' }, 'both'],
];

/** Parámetros del caso para un lado: los de la base usan orgB*. */
function paramsFor(p, side) {
  const o = { ...DEFAULTS, quality: 'preview' };
  const ORGK = ['orgCols', 'orgRows', 'orgMinL', 'orgMinW', 'orgDepth', 'orgCover', 'orgScoop'];
  for (const [k, v] of Object.entries(p)) {
    if (!ORGK.includes(k)) { o[k] = v; continue; }
    if (side !== 'base') o[k] = v;
    if (side !== 'lid') o[k.replace('org', 'orgB')] = v;
  }
  if (side !== 'base') o.lidMode = 'org';
  if (side !== 'lid') o.insertMode = 'org';
  return o;
}

const mulM = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };

const only = process.argv[2];                      // filtro opcional por nombre
for (const [name, p, sideSpec = 'lid'] of only === 'combinaciones' ? [] : cases) {
  if (only && !name.includes(only)) continue;
  console.log(`\n${name}`);
  const P = paramsFor(p, sideSpec);
  const r = build(P, null, { normals: false });
  // Choques: con los resaltes de clic a ras (su interferencia es a propósito).
  const rs = build({ ...P, _orgNoSnap: true }, null, { normals: false });
  const D = r.D;
  const bad = r.parts.filter((x) => x.status !== 'NoError' || (x.components > 1 && x.id !== 'gasket'));
  check(!bad.length, `${r.parts.length} piezas válidas de un solo sólido${bad.length ? ' — ' + bad.map((x) => `${x.name} ${x.components}`).join(', ') : ''}`);
  check(!r.parts.some((x) => x.id === 'cap') || D.pinMode === 'filament' || D.latchPinMode === 'filament', 'los compartimentos no añaden pasadores ni tapones sueltos');
  for (const side of sideSpec === 'both' ? ['lid', 'base'] : [sideSpec]) checkSide(P, r, rs, side, sideSpec === 'both');
}

function checkSide(P, r, rs, side, both) {
  const D = r.D, isB = side === 'base';
  const O = isB ? D.orgB : D.org;
  const tag = both ? (isB ? '[base] ' : '[tapa] ') : '';
  const Q = isB ? { minL: P.orgBMinL, minW: P.orgBMinW, depth: P.orgBDepth } : { minL: P.orgMinL, minW: P.orgMinW, depth: P.orgDepth };
  check(!!O, `${tag}compartimentos activos${O ? `: ${O.cols}×${O.rows} celdas de ${O.cellL}×${O.cellW}×${O.depth} mm, interior ${D.Li}×${D.Wi}, ${isB ? 'base ' + D.Db : 'tapa ' + D.Dl}` : ' — ' + D.warn.join(' | ')}`);
  if (!O) return;
  check((!Q.minL || O.cellL >= Q.minL - 0.01) && (!Q.minW || O.cellW >= Q.minW - 0.01) && (!Q.depth || O.depth >= Q.depth - 0.01),
    `${tag}celdas ≥ lo pedido (${Q.minL || '-'}×${Q.minW || '-'}×${Q.depth || '-'})`);
  const mine = (x) => x.id === 'orgPanel' && x.side === side;
  const panelsP = r.parts.filter(mine);
  check(panelsP.reduce((s, x) => s + x.instances.length, 0) === O.panels.length, `${tag}${O.panels.length} tapas interiores en ${panelsP.length} pieza(s) distinta(s)`);
  const z0 = r.assembly.z0;
  // Todo al "marco de tapa" (sin z0): la base y lo suyo, con el giro de 180°.
  const RX = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 2 * D.Hb, 1];
  const toFrame = isB ? mulM(RX, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -z0, 1]) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -z0, 1];
  const native = (id) => toMan(r.parts.find((x) => x.id === id).mesh, isB ? RX : null);
  const lid = native(isB ? 'base' : 'lid');          // la mitad con los compartimentos
  const base = native(isB ? 'lid' : 'base');         // la otra mitad
  if (!O.has) {
    // Sin tapas interiores: solo celdas. Las celdas existen (hueco libre).
    const c = O.cells[0];
    const probe = M().cube([c.x1 - c.x0 - 2, c.y1 - c.y0 - 2, O.depth / 2]).translate([c.x0 + 1, c.y0 + 1, O.zp1 + 1]);
    check(probe.intersect(lid).volume() < 0.05, `${tag}celdas abiertas sin tapa interior`);
    return;
  }
  const panels = [];
  for (const pp of rs.parts.filter(mine)) pp.instances.forEach((inst) => {
    const m = toMan(pp.mesh, mulM(toFrame, inst));
    // Eje de esta copia: el de la distribución cuyo borde coincide.
    const bb = m.boundingBox();
    const pan = O.panels.reduce((best, q) => (Math.abs(q.ax0 - bb.min[0]) + Math.abs(q.axis.y - ORG.rho - bb.min[1]) < Math.abs(best.ax0 - bb.min[0]) + Math.abs(best.axis.y - ORG.rho - bb.min[1]) ? q : best), O.panels[0]);
    panels.push({ m, pan, ax: pan.axis, part: pp });
  });
  check(new Set(panels.map((q) => q.pan)).size === O.panels.length, `${tag}cada tapa interior está en su sitio (${panels.length} copias ↔ ${O.panels.length} huecos)`);
  // El eje que da la pieza (para el visor) coincide con el de la distribución.
  {
    let worstAx = 0;
    for (const pp of r.parts.filter(mine)) pp.instances.forEach((inst) => {
      const ay = pp.axis.y + inst[13], az = pp.axis.z;
      const yz = isB ? [-(ay), 2 * D.Hb - (az - z0)] : [ay, az - z0];
      worstAx = Math.max(worstAx, Math.min(...O.panels.map((q) => Math.hypot(q.axis.y - yz[0], q.axis.z - yz[1]))));
    });
    check(worstAx < 0.02, `${tag}eje de giro de cada copia = eje de la distribución (${worstAx.toFixed(3)} mm)`);
  }
  const all = M().union(panels.map((q) => q.m));
  const vLid = lid.intersect(all).volume(), vBase = base.intersect(all).volume();
  let vIns = 0;
  for (const ins of r.parts.filter((x) => x.id === 'insert' || x.id === 'insertLid' || (x.id === 'orgPanel' && x.side !== side))) {
    for (const inst of ins.instances) vIns += toMan(ins.mesh, mulM(toFrame, inst)).intersect(all).volume();
  }
  check(vLid < 0.05 && vBase < 0.05 && vIns < 0.05, `${tag}cerrada sin solapes (su mitad ${vLid.toFixed(2)}, la otra ${vBase.toFixed(2)}, resto ${vIns.toFixed(2)} mm³)`);
  let worst = 0, where = '';
  panels.forEach((q, i) => {
    const others = panels.length > 1 ? M().union(panels.filter((_, j) => j !== i).map((o) => o.m)) : null;
    for (const a of [15, 45, 70, 95]) {
      const rm = rotX(q.m, -a, q.ax.y, q.ax.z);
      const v = rm.intersect(lid).volume() + (others ? rm.intersect(others).volume() : 0);
      if (v > worst) { worst = v; where = `tapa ${i + 1} a ${a}°`; }
    }
  });
  check(worst < 0.5, `${tag}todas abren 0–95° sin chocar (peor ${worst.toFixed(2)} mm³ ${where})`);
  check(O.a > ORG.rho && O.lip >= 0.25 && ORG.pinE - O.lip >= 0.6 && O.hd > ORG.pinE,
    `${tag}pivotes Ø${2 * ORG.rho} en agujero cerrado Ø${(2 * O.a).toFixed(2)}: entran ${ORG.pinE} mm, retén de montaje ${O.lip} mm`);
  // Camino de montaje: la tapa interior entra deslizando hacia −Y; fuera de
  // las puntas de los pivotes (el retén, que salta) no toca su mitad.
  {
    let worstM = 0;
    const seen = new Set();
    for (const q of panels) {
      if (seen.has(q.part)) continue;
      seen.add(q.part);
      const pan = q.pan;
      for (const dy of [0.4, 1.2, 2.2, O.blockR + 0.6, O.blockR + 1.6]) {
        const tips = M().union([
          M().cube([O.lip + 0.05, 8, 8]).translate([pan.ax0 - 0.05, pan.axis.y - 4 + dy, pan.axis.z - 4]),
          M().cube([O.lip + 0.05, 8, 8]).translate([pan.ax1 - O.lip, pan.axis.y - 4 + dy, pan.axis.z - 4]),
        ]);
        // Se monta abierta (colgando a 90°, como queda al abrirla) y deslizando hacia −Y.
        const qq = rotX(q.m, -90, pan.axis.y, pan.axis.z);
        worstM = Math.max(worstM, qq.translate([0, dy, 0]).subtract(tips).intersect(lid).volume());
      }
    }
    check(worstM < 0.05, `${tag}se monta deslizando hacia −Y: solo saltan los retenes (${worstM.toFixed(3)} mm³)`);
    // Retención: sin doblar la tapa interior, los pivotes no salen (ni hacia +Y
    // por la ranura, ni hacia abajo/arriba).
    let held = Infinity;
    for (const pp of r.parts.filter(mine)) {
      const q = toMan(pp.mesh, mulM(toFrame, pp.instances[0]));
      for (const d of [[0, 0.8, 0], [0, 0, -0.8], [0, 0, 0.8]]) held = Math.min(held, q.translate(d).intersect(lid).volume());
    }
    check(held > 0.05, `${tag}los pivotes quedan retenidos en sus agujeros (mín. ${held.toFixed(2)} mm³ de choque al intentar sacarla)`);
  }
  // Apertura: pozo libre y pestaña.
  {
    const wellsOk = O.panels.filter((q) => q.well).every((q) => {
      const w = q.well;
      const probe = M().cube([w.x1 - w.x0 - 2, w.y1 - w.yTab - 1.2, w.h - 1.2 + O.g0]).translate([w.x0 + 1, w.yTab + 0.6, D.Hb + 0.3]);
      const free = probe.intersect(lid).volume() + probe.intersect(all).volume();
      const tab = M().cube([w.x1 - w.x0 - 2, w.yTab - w.y0 - 1, O.ct - 0.2]).translate([w.x0 + 1, w.y0 + 0.5, O.zp0 + 0.1]).intersect(all).volume();
      return free < 0.05 && tab > 0.5 * (w.x1 - w.x0 - 2) * (w.yTab - w.y0 - 1) * (O.ct - 0.2);
    });
    const nW = O.panels.filter((q) => q.well).length;
    const fits = O.cellW >= 22 && O.cellL >= 14;
    check((nW > 0 || !fits) && wellsOk, `${tag}pozo para el dedo libre y pestaña en ${nW}/${O.panels.length} tapas interiores${fits ? '' : ' (celdas demasiado pequeñas para un dedo)'}`);
  }
  // Divisores (y pilares de imán) separados de la pared exterior a media altura de celda.
  {
    const zm = (O.zp1 + O.zi) / 2;
    const layer = lid.slice(zm);
    const band = rrOffset(D, 0).subtract(rrOffset(D, -(O.gap - 0.1)));
    const touch = layer.intersect(band).area();
    check(touch < 0.5, `${tag}divisores y carriles no tocan la pared exterior (${touch.toFixed(2)} mm² en la ranura de ${O.gap} mm)`);
  }
  const vol = (rr) => rr.parts.filter(mine).reduce((acc, x) => acc + x.volume * x.instances.length, 0);
  const want = isB ? P.orgLatch : P.orgLatch;
  if (O.latch === 'magnet') {
    const Mg = O.magnet;
    check(Math.abs(vol(r) - vol(rs)) < 0.01 && O.panels.every((q) => q.snapCells.length === 0), `${tag}traba magnética: sin resaltes de clic`);
    check(O.panels.every((q) => q.magnets && q.magnets.length >= 1) && O.magnets.length === O.panels.reduce((a, q) => a + q.magnets.length, 0),
      `${tag}${O.magnets.length} parejas de imanes Ø${Mg.d}×${Mg.h} (${O.panels.map((q) => q.magnets.length).join('+')})`);
    check(Math.abs(Mg.d - P.magnetD) < 1e-9 && Math.abs(Mg.h - P.magnetH) < 1e-9 && Mg.rIn < Mg.d / 2 + 0.05 && Mg.rOut > Mg.d / 2 + 0.2 && Mg.pd >= Mg.h + 0.1 - 1e-9,
      `${tag}alojamiento a presión: nervios a Ø${(2 * Mg.rIn).toFixed(2)} (imán Ø${Mg.d}), agujero Ø${(2 * Mg.rOut).toFixed(2)}, fondo ${Mg.pd} mm`);
    const zc = O.zp1 + Mg.hb, ztB = zc + MAG.air;
    let freeB = 0, freeC = 0, ribB = Infinity, ribC = Infinity, wallB = Infinity, skin = Infinity, sym = 0;
    const cyl = (m, r0, za, zb2) => M().cylinder(zb2 - za, r0, r0, 48).translate([m.x, m.y, za]);
    for (const m of O.magnets) {
      // Hueco libre para el imán (dentro de los nervios) en cuerpo y tapa interior.
      freeB = Math.max(freeB, cyl(m, Mg.rIn - 0.03, ztB - 0.3, ztB + Mg.pd - 0.02).intersect(lid).volume());
      freeC = Math.max(freeC, cyl(m, Mg.rIn - 0.03, zc - Mg.pd + 0.02, zc + 0.15).intersect(all).volume());
      // Nervios de aplastamiento: material entre rIn y rOut a media altura.
      const ringV = (solid, za, zb2) => cyl(m, Mg.rOut - 0.02, za, zb2).intersect(solid).volume();
      ribB = Math.min(ribB, ringV(lid, ztB + MAG.lead + 0.1, ztB + Mg.pd - 0.1));
      ribC = Math.min(ribC, ringV(all, zc - Mg.pd + 0.1, zc - MAG.lead - 0.1));
      // Pared alrededor del alojamiento del cuerpo (pilar) y piel bajo el imán de la tapa interior.
      const tube = cyl(m, Mg.Rp - 0.05, ztB + 0.5, ztB + Mg.pd - 0.1).subtract(cyl(m, Mg.rOut + 0.05, ztB, ztB + Mg.pd));
      wallB = Math.min(wallB, tube.intersect(lid).volume() / tube.volume());
      const sk = cyl(m, Mg.rIn, O.zp0 + 0.02, zc - Mg.pd - 0.02);
      skin = Math.min(skin, sk.intersect(all).volume() / sk.volume());
    }
    for (const q of O.panels) if (q.magnets.length > 1) sym = Math.max(sym, Math.abs(q.magnets.reduce((a, m) => a + m.x, 0) / q.magnets.length - (q.x0 + q.x1) / 2));
    check(freeB < 0.02 && freeC < 0.02, `${tag}el imán entra en los dos alojamientos (estorbo ${freeB.toFixed(3)} / ${freeC.toFixed(3)} mm³)`);
    check(ribB > 0.05 && ribC > 0.05, `${tag}nervios de aplastamiento en los dos (${ribB.toFixed(2)} / ${ribC.toFixed(2)} mm³)`);
    check(wallB > 0.72 && skin > 0.99 && zc - Mg.pd - O.zp0 >= MAG.skin - 1e-6, `${tag}pilar con pared alrededor del imán (${(wallB * 100).toFixed(0)} %) y piel de ${(zc - Mg.pd - O.zp0).toFixed(2)} mm bajo el de la tapa interior`);
    check(Math.abs(MAG.air + 2 * MAG.recess - 0.4) < 1e-9 && O.depth >= Mg.hb + MAG.air + Mg.pd + 0.8, `${tag}imanes cara con cara a ${(MAG.air + 2 * MAG.recess).toFixed(1)} mm; celda de ${O.depth} mm ≥ ${(Mg.hb + MAG.air + Mg.pd + 0.8).toFixed(1)}`);
    check(sym < 0.05, `${tag}imanes repartidos simétricos respecto a la pestaña (${sym.toFixed(3)} mm)`);
  } else {
    check(want !== 'magnet' || !!O.magnetWarn, `${tag}traba de clic${want === 'magnet' ? ' (el imán no cabía: aviso)' : ''}`);
    // Cada tapa interior con celdas de clic lleva de verdad sus resaltes.
    const extra = vol(r) - vol(rs);
    check(extra > 0.5 * O.panels.reduce((acc, q) => acc + q.snapCells.length, 0), `${tag}resaltes de clic presentes (${extra.toFixed(1)} mm³ en ${O.panels.reduce((acc, q) => acc + q.snapCells.length, 0)} celdas)`);
    check(Math.abs(O.sealClr - D.sealClr) < 1e-6 && O.snap - O.sealClr >= 0.15, `${tag}faldón con holgura ${O.sealClr} y resalte de ${(O.snap - O.sealClr).toFixed(2)} de interferencia`);
  }
  const ov = panelsP.map(steepOverhang);
  check(ov.every((v) => v < 0.5), `${tag}tapas interiores sin voladizos > 50° (${ov.map((v) => v.toFixed(1)).join(', ')} mm²)`);
  const half = isB ? 'base' : 'lid';
  const plain = build({ ...P, ...(isB ? { insertMode: 'off' } : { lidMode: 'off' }) }, null, { normals: false }).parts.find((x) => x.id === half);
  const halfP = r.parts.find((x) => x.id === half);
  const dv = steepOverhang(halfP) - steepOverhang(plain);
  check(dv < 1.0 || !!halfP.tilt, `${tag}la ${isB ? 'base' : 'tapa'} no gana voladizos con los compartimentos (${dv.toFixed(1)} mm²${halfP.tilt ? ', inclinada: soportes del motor' : ''})`);
  const B = { x: P.bedX - 4, y: P.bedY - 4 };
  const fitsAll = panelsP.every((pp) => fitAngle(hull2D(transformVerts(pp.mesh.vert, pp.mesh.numProp, pp.print)), B.x, B.y).ok);
  check(fitsAll, `${tag}las tapas interiores caben en la cama`);
}

/* Cualquier combinación de contenido: 4 opciones en la base × 4 en la tapa. */
console.log('\nLas 16 combinaciones de contenido (base × tapa)');
{
  const MODES = ['off', 'blank', 'pockets', 'org'];
  const NAME = { off: 'nada', blank: 'inserto', pockets: 'huecos', org: 'compartimentos' };
  const poly = [[[-35, -12], [35, -12], [35, 12], [-35, 12]]];
  for (const b of MODES) for (const l of MODES) {
    const P = { ...DEFAULTS, quality: 'preview', innerL: 140, innerW: 90, baseDepth: 38, lidDepth: 20, insertMode: b, lidMode: l,
      orgCols: 3, orgRows: 2, orgBCols: 3, orgBRows: 2, orgCover: 'row', orgBCover: 'cell', orgLatch: 'magnet', contentPolys: poly };
    const r = build(P, null, { normals: false });
    const rs = build({ ...P, _orgNoSnap: true }, null, { normals: false });
    const D = r.D, z0 = r.assembly.z0;
    const ids = r.parts.map((x) => `${x.id}${x.side === 'base' ? ':base' : ''}`);
    const want = [
      ...(b === 'blank' || b === 'pockets' ? ['insert'] : []), ...(l === 'blank' || l === 'pockets' ? ['insertLid'] : []),
      ...(b === 'org' ? ['orgPanel:base'] : []), ...(l === 'org' ? ['orgPanel'] : []),
    ];
    const extra = ['insert', 'insertLid', 'orgPanel:base', 'orgPanel'].filter((k) => ids.includes(k));
    const bad = r.parts.filter((x) => x.status !== 'NoError' || (x.components > 1 && x.id !== 'gasket'));
    // Todo lo que va dentro, en su sitio, sin tocar base ni tapa ni entre sí.
    const base = toMan(r.parts.find((x) => x.id === 'base').mesh), lid = toMan(r.parts.find((x) => x.id === 'lid').mesh);
    const inner = rs.parts.filter((x) => ['insert', 'insertLid', 'orgPanel'].includes(x.id))
      .flatMap((x) => x.instances.map((inst) => toMan(x.mesh, inst).translate([0, 0, -z0])));
    let v = 0;
    for (let i = 0; i < inner.length; i++) {
      v += inner[i].intersect(base).volume() + inner[i].intersect(lid).volume();
      for (let j = i + 1; j < inner.length; j++) v += inner[i].intersect(inner[j]).volume();
    }
    const pk = (side, ins) => D.content[side] !== 'pockets' || (ins && ins.pockets === 1);
    check(!bad.length && JSON.stringify([...want].sort()) === JSON.stringify([...extra].sort()) && v < 0.05 && D.content.base === b && D.content.lid === l
      && pk('base', D.insert) && pk('lid', D.insertLid) && !D.warn.some((w) => /no cabe|demasiado/.test(w)),
      `base: ${NAME[b]} + tapa: ${NAME[l]} → ${r.parts.length} piezas, interior sin solapes (${v.toFixed(2)} mm³)${bad.length ? ' — inválidas: ' + bad.map((x) => x.name).join(', ') : ''}${D.warn.length ? ' — ' + D.warn.join(' | ') : ''}`);
  }
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
