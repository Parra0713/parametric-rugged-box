/**
 * Organizador en la tapa (Node):
 *   node tests/organizer.test.mjs
 *
 * Para cada configuración (tapa única / por fila / por celda / sin tapa,
 * cajas XS a L, octógono, apilable, girada, inclinada):
 *  1. Piezas válidas de un solo sólido; celdas ≥ el mínimo pedido (la caja
 *     y la tapa crecen si hace falta) y altura de celda ≥ la pedida.
 *  2. Cerrada: las tapas interiores no se solapan con la tapa, la base ni
 *     entre sí (la caja cierra con el organizador lleno).
 *  3. Cada tapa interior abre 0–95° sobre su eje sin chocar.
 *  4. Bisagra de pivotes: eje Ø3 < agujero (gira), cada pivote entra
 *     `pinE` en un agujero CERRADO; la ranura de montaje deja un retén
 *     (`lip`) y el camino de montaje (deslizar hacia −Y) solo roza en ese
 *     retén. Faldón con la holgura calibrada y resalte con interferencia.
 *  7. Apertura: pozo para el dedo libre (sin tapa ni tapa encima) y pestaña
 *     de la tapa interior sobre su primera mitad.
 *  8. Divisores y carriles separados de la pared exterior (sin marcas).
 *  5. Imprimibles sin soportes: tapas interiores sin voladizos > 50°; la tapa
 *     no gana voladizos por el organizador. Caben en la cama.
 *  6. Sin piezas sueltas: el organizador no añade pasadores ni tapones.
 */
import Module from 'manifold-3d';
import { init, build } from '../src/engine/engine.js';
import { DEFAULTS } from '../src/engine/params.js';
import { M, CS, prism } from '../src/engine/geo.js';
import { rrOffset } from '../src/engine/seal.js';
import { ORG } from '../src/engine/orgLayout.js';
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
const cases = [
  ['herramienta · una tapa', { ...user, orgCover: 'single' }],
  ['herramienta · por fila', { ...user, orgCover: 'row' }],
  ['herramienta · por celda', { ...user, orgCover: 'cell' }],
  ['herramienta · sin tapa', { ...user, orgCover: 'none' }],
  ['S 60×40 · 3×2 por celda', { innerL: 60, innerW: 40, baseDepth: 21, lidDepth: 12, orgCols: 3, orgRows: 2, orgCover: 'cell' }],
  ['XS 40×30 · 2×1 una tapa', { innerL: 40, innerW: 30, baseDepth: 15, lidDepth: 10, orgCols: 2, orgRows: 1, orgCover: 'single' }],
  ['M octógono · 5×3 por fila', { innerL: 160, innerW: 90, cornerCut: 15, orgCols: 5, orgRows: 3, orgCover: 'row' }],
  ['M apilable + girada · 2×4 una tapa', { innerL: 80, innerW: 140, stackable: true, orgCols: 2, orgRows: 4, orgCover: 'single' }],
  ['L inclinada · 6×4 por celda', { innerL: 230, innerW: 160, baseDepth: 40, lidDepth: 30, orgCols: 6, orgRows: 4, orgCover: 'cell' }],
];

for (const [name, p] of cases) {
  console.log(`\n${name}`);
  const P = { ...DEFAULTS, ...p, lidOrg: true, quality: 'preview' };
  const r = build(P, null, { normals: false });
  const D = r.D, O = D.org;
  check(!!O, `organizador activo${O ? `: ${O.cols}×${O.rows} celdas de ${O.cellL}×${O.cellW}×${O.depth} mm, interior ${D.Li}×${D.Wi}, tapa ${D.Dl}` : ' — ' + D.warn.join(' | ')}`);
  if (!O) continue;
  const bad = r.parts.filter((x) => x.status !== 'NoError' || (x.components > 1 && x.id !== 'gasket'));
  check(!bad.length, `${r.parts.length} piezas válidas de un solo sólido${bad.length ? ' — ' + bad.map((x) => `${x.name} ${x.components}`).join(', ') : ''}`);
  check((!P.orgMinL || O.cellL >= P.orgMinL - 0.01) && (!P.orgMinW || O.cellW >= P.orgMinW - 0.01) && (!P.orgDepth || O.depth >= P.orgDepth - 0.01),
    `celdas ≥ lo pedido (${P.orgMinL || '-'}×${P.orgMinW || '-'}×${P.orgDepth || '-'})`);
  const panelsP = r.parts.filter((x) => x.id === 'orgPanel');
  check(panelsP.reduce((s, x) => s + x.instances.length, 0) === O.panels.length, `${O.panels.length} tapas interiores en ${panelsP.length} pieza(s) distinta(s)`);
  check(!r.parts.some((x) => x.id === 'cap') || D.pinMode === 'filament' || D.latchPinMode === 'filament', 'el organizador no añade pasadores ni tapones sueltos');
  if (!O.has) continue;
  const z0 = r.assembly.z0;
  // Choques: con los resaltes de clic a ras (su interferencia es a propósito).
  const rs = build({ ...P, _orgNoSnap: true }, null, { normals: false });
  const lid = toMan(r.parts.find((x) => x.id === 'lid').mesh).translate([0, 0, z0]);
  const base = toMan(r.parts.find((x) => x.id === 'base').mesh).translate([0, 0, z0]);
  const panels = [];
  for (const pp of rs.parts.filter((x) => x.id === 'orgPanel')) pp.instances.forEach((inst) => panels.push({ m: toMan(pp.mesh, inst), ax: { y: pp.axis.y + inst[13], z: pp.axis.z } }));
  const all = M().union(panels.map((q) => q.m));
  const vLid = lid.intersect(all).volume(), vBase = base.intersect(all).volume();
  let vIns = 0;
  const ins = r.parts.find((x) => x.id === 'insert');
  if (ins) vIns = toMan(ins.mesh, ins.instances[0]).intersect(all).volume();
  check(vLid < 0.05 && vBase < 0.05 && vIns < 0.05, `cerrada sin solapes (tapa ${vLid.toFixed(2)}, base ${vBase.toFixed(2)} mm³)`);
  let worst = 0, where = '';
  panels.forEach((q, i) => {
    const others = panels.length > 1 ? M().union(panels.filter((_, j) => j !== i).map((o) => o.m)) : null;
    for (const a of [15, 45, 70, 95]) {
      const rm = rotX(q.m, -a, q.ax.y, q.ax.z);
      const v = rm.intersect(lid).volume() + (others ? rm.intersect(others).volume() : 0);
      if (v > worst) { worst = v; where = `tapa ${i + 1} a ${a}°`; }
    }
  });
  check(worst < 0.5, `todas abren 0–95° sin chocar (peor ${worst.toFixed(2)} mm³ ${where})`);
  check(O.a > ORG.rho && O.lip >= 0.25 && ORG.pinE - O.lip >= 0.6 && O.hd > ORG.pinE,
    `pivotes Ø${2 * ORG.rho} en agujero cerrado Ø${(2 * O.a).toFixed(2)}: entran ${ORG.pinE} mm, retén de montaje ${O.lip} mm`);
  // Camino de montaje: la tapa interior entra deslizando hacia −Y; fuera de
  // las puntas de los pivotes (el retén, que salta) no toca la tapa.
  {
    let worstM = 0;
    const qs = rs.parts.filter((x) => x.id === 'orgPanel');
    for (const pp of qs) {
      const inst = pp.instances[0];
      const q = toMan(pp.mesh, inst);
      const dx = inst[12];
      const pan = O.panels.find((p) => Math.abs(p.x0 - (pp.bbox.min[0] + dx)) < 1.5 || Math.abs(p.ax0 - (pp.bbox.min[0] + dx)) < 1.5) || O.panels[0];
      for (const dy of [0.4, 1.2, 2.2, O.blockR + 0.6, O.blockR + 1.6]) {
        const tips = M().union([
          M().cube([O.lip + 0.05, 8, 8]).translate([pan.ax0 - 0.05, pan.axis.y - 4 + dy, pan.axis.z - 4]),
          M().cube([O.lip + 0.05, 8, 8]).translate([pan.ax1 - O.lip, pan.axis.y - 4 + dy, pan.axis.z - 4]),
        ]);
        // Se monta abierta (colgando a 90°, como queda al abrirla) y deslizando hacia −Y.
        const qq = rotX(q, -90, pan.axis.y, pan.axis.z + z0);
        worstM = Math.max(worstM, qq.translate([0, dy, 0]).subtract(tips.translate([0, 0, z0])).intersect(lid).volume());
      }
    }
    check(worstM < 0.05, `se monta deslizando hacia −Y: solo saltan los retenes (${worstM.toFixed(3)} mm³)`);
    // Retención: sin doblar la tapa interior, los pivotes no salen (ni hacia +Y
    // por la ranura, ni hacia abajo/arriba).
    let held = Infinity;
    for (const pp of qs) {
      const q = toMan(pp.mesh, pp.instances[0]);
      for (const d of [[0, 0.8, 0], [0, 0, -0.8], [0, 0, 0.8]]) held = Math.min(held, q.translate(d).intersect(lid).volume());
    }
    check(held > 0.05, `los pivotes quedan retenidos en sus agujeros (mín. ${held.toFixed(2)} mm³ de choque al intentar sacarla)`);
  }
  // Apertura: pozo libre y pestaña.
  {
    const wellsOk = O.panels.filter((p) => p.well).every((p) => {
      const w = p.well;
      const probe = M().cube([w.x1 - w.x0 - 2, w.y1 - w.yTab - 1.2, w.h - 1.2 + O.g0]).translate([w.x0 + 1, w.yTab + 0.6, D.Hb + z0 + 0.3]);
      const free = probe.intersect(lid).volume() + probe.intersect(all).volume();
      const tab = M().cube([w.x1 - w.x0 - 2, w.yTab - w.y0 - 1, O.ct - 0.2]).translate([w.x0 + 1, w.y0 + 0.5, O.zp0 + z0 + 0.1]).intersect(all).volume();
      return free < 0.05 && tab > 0.5 * (w.x1 - w.x0 - 2) * (w.yTab - w.y0 - 1) * (O.ct - 0.2);
    });
    const nW = O.panels.filter((p) => p.well).length;
    const fits = O.cellW >= 22 && O.cellL >= 14;
    check((nW > 0 || !fits) && wellsOk, `pozo para el dedo libre y pestaña en ${nW}/${O.panels.length} tapas interiores${fits ? '' : ' (celdas demasiado pequeñas para un dedo)'}`);
  }
  // Divisores separados de la pared exterior a media altura de celda.
  {
    const zm = (O.zp1 + O.zi) / 2 + z0;
    const layer = lid.slice(zm);
    const band = rrOffset(D, 0).subtract(rrOffset(D, -(O.gap - 0.1)));
    const touch = layer.intersect(band).area();
    check(touch < 0.5, `divisores y carriles no tocan la pared exterior (${touch.toFixed(2)} mm² en la ranura de ${O.gap} mm)`);
  }
  {
    // Cada tapa interior con celdas de clic lleva de verdad sus resaltes.
    const vol = (rr) => rr.parts.filter((x) => x.id === 'orgPanel').reduce((acc, x) => acc + x.volume * x.instances.length, 0);
    const extra = vol(r) - vol(rs);
    check(extra > 0.5 * O.panels.reduce((acc, p) => acc + p.snapCells.length, 0), `resaltes de clic presentes (${extra.toFixed(1)} mm³ en ${O.panels.reduce((acc, p) => acc + p.snapCells.length, 0)} celdas)`);
  }
  check(Math.abs(O.sealClr - D.sealClr) < 1e-6 && O.snap - O.sealClr >= 0.15, `faldón con holgura ${O.sealClr} y resalte de ${(O.snap - O.sealClr).toFixed(2)} de interferencia`);
  const ov = panelsP.map(steepOverhang);
  check(ov.every((v) => v < 0.5), `tapas interiores sin voladizos > 50° (${ov.map((v) => v.toFixed(1)).join(', ')} mm²)`);
  const lid0 = build({ ...P, lidOrg: false }, null, { normals: false }).parts.find((x) => x.id === 'lid');
  const lidP = r.parts.find((x) => x.id === 'lid');
  const dv = steepOverhang(lidP) - steepOverhang(lid0);
  check(dv < 1.0 || !!lidP.tilt, `la tapa no gana voladizos con el organizador (${dv.toFixed(1)} mm²${lidP.tilt ? ', inclinada: soportes del motor' : ''})`);
  const B = { x: P.bedX - 4, y: P.bedY - 4 };
  const fitsAll = panelsP.every((pp) => fitAngle(hull2D(transformVerts(pp.mesh.vert, pp.mesh.numProp, pp.print)), B.x, B.y).ok);
  check(fitsAll, 'las tapas interiores caben en la cama');
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
