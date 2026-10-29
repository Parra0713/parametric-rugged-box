/**
 * organizer.js — Geometría del organizador en la tapa (ver orgLayout.js).
 */
import { M, CS, prism, teardrop, poly, roundRect, unionAll, yzExtrude } from './geo.js';
import { rrOffset } from './seal.js';
import { ORG } from './orgLayout.js';

/* ================================================================ */
/*  Geometría                                                       */
/* ================================================================ */

const box = (x0, x1, y0, y1, z0, z1) => M().cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
const rectCS = (x0, x1, y0, y1) => CS().square([x1 - x0, y1 - y0], false).translate([x0, y0]);
/** Rectángulo de esquinas redondeadas (x0..x1, y0..y1). */
const rrCS = (x0, x1, y0, y1, r, seg) => roundRect(x1 - x0, y1 - y0, r, seg).translate([(x0 + x1) / 2, (y0 + y1) / 2]);

/** Contorno de una celda (recortado al interior de la caja: octógono, radios). */
function cellCS(D, O, c, inset = 0) {
  let cs = rrCS(c.x0 + inset, c.x1 - inset, c.y0 + inset, c.y1 - inset, Math.max(0.3, O.rc - inset), D.seg);
  cs = cs.intersect(rrOffset(D, -inset));
  if (c.lim) cs = cs.intersect(rectCS(-c.lim + inset, c.lim - inset, -D.Wi, D.Wi));
  return cs;
}

/** Cilindro de eje X. */
const xCyl = (x0, x1, y, z, r, seg) => M().cylinder(x1 - x0, r, r, seg).rotate([0, 90, 0]).translate([x0, y, z]);

/** Sólido que se añade a la tapa y huecos que se le quitan. */
export function orgLidGeometry(D) {
  const O = D.org;
  // Bloque: todo el interior de la tapa entre zp1 y el techo, menos las celdas.
  const block0 = prism(rrOffset(D, 0.01), O.zp1, O.zi + 0.01);
  const cuts = [];
  for (const c of O.cells) {
    const cs = cellCS(D, O, c);
    // Fondo con chaflán a 45° (se recogen mejor las piezas pequeñas). Al
    // imprimir boca abajo el chaflán mira hacia arriba: sin soporte.
    const s = O.scoop;
    cuts.push(prism(cs, O.zp1 - 1, O.zi - s + 0.01));
    if (s > 0.3) {
      const top = cellCS(D, O, c, s);
      cuts.push(M().hull([prism(cs, O.zi - s, O.zi - s + 0.01), prism(top, O.zi - 0.01, O.zi)]));
    }
  }
  const block = block0.subtract(unionAll(cuts));
  const adds = [block];
  const lidCuts = [];
  if (O.has) {
    for (const p of O.panels) {
      // Canal del eje en el carril (el eje sobresale por encima de zp1), solo
      // a lo largo del eje de cada tapa interior.
      const x0 = Math.max(-D.Li / 2 + 0.01, (p.ax0 ?? p.x0) - 0.4), x1 = Math.min(D.Li / 2 - 0.01, (p.ax1 ?? p.x1) + 0.4);
      lidCuts.push(xCyl(x0, x1, p.axis.y, p.axis.z, O.a, D.seg));
    }
    // Grapas: en cada muesca de cada tapa interior.
    const s = (ORG.open * 2 * ORG.rho) / 2;                  // media boca
    for (const p of O.panels) {
      const ax = p.axis;
      for (const xc of p.clips) {
        const x0 = xc - ORG.clipL / 2, x1 = xc + ORG.clipL / 2;
        const zb = ax.z - O.a * Math.SQRT2 - 1.0;            // 1 mm bajo la punta de la gota
        // Perfil YZ de la grapa (u = Y, v = Z).
        const body = rectCS(ax.y - O.a - ORG.back, ax.y + O.a + ORG.front, zb, O.zp1 + 0.01);
        const hole = teardrop(ax.y, ax.z, O.a, false, D.seg);   // punta hacia −Z: arriba al imprimir boca abajo
        // Boca hacia +Y a la altura del eje: cara inferior horizontal (el
        // brazo de abajo queda grueso; con una rampa a 45° paralela al flanco
        // de la gota quedaba una lámina de 0.4 mm) y chaflán de entrada de
        // 0.6 mm en la arista exterior.
        const yF = ax.y + O.a + ORG.front;
        const slot = poly([[ax.y, ax.z + s], [yF + 1, ax.z + s], [yF + 1, ax.z - s - 1.6], [yF - 0.6, ax.z - s], [ax.y, ax.z - s]]);
        // La esquina de abajo‑delante se redondea con centro en el eje: por
        // ahí pasa el borde de la muesca de la tapa interior al abrirse.
        const keep = CS().union([
          CS().circle(O.a * Math.SQRT2 + 1.05, D.seg).translate([ax.y, ax.z]),
          rectCS(ax.y - 20, ax.y, ax.z - 20, ax.z + 20),
          rectCS(ax.y - 20, ax.y + 20, ax.z, ax.z + 20),
        ]);
        const prof = body.intersect(keep).subtract(hole).subtract(slot);
        adds.push(yzExtrude(prof, x0, x1));
      }
      // Rebaje para la pestaña de la uña en el borde libre.
      const yT = p.y1;
      lidCuts.push(box(p.tab - ORG.tabW / 2 - 0.5, p.tab + ORG.tabW / 2 + 0.5, yT - 0.01, yT + ORG.tabL + 0.5, D.Hb + 0.01, O.zp1 + 0.6));
    }
  }
  return { add: unionAll(adds.filter(Boolean)), cut: lidCuts.length ? unionAll(lidCuts) : null };
}

/** Una tapa interior en su posición cerrada (marco interno). */
export function orgPanel(D, p) {
  const O = D.org;
  const ax = p.axis;
  // Placa: del eje al borde libre, recortada al interior de la caja.
  let plate = rectCS(p.x0, p.x1, ax.y, p.y1).intersect(rrOffset(D, D.cham > 0 ? -1.0 : -0.3));
  if (p.lim) plate = plate.intersect(rectCS(-p.lim, p.lim, -D.Wi, D.Wi));
  // Muescas para las grapas (la placa no; el eje sí pasa por ellas).
  const notches = p.clips.map((xc) => rectCS(xc - ORG.clipL / 2 - ORG.notch, xc + ORG.clipL / 2 + ORG.notch,
    ax.y - O.a - ORG.back - 1, ax.y + O.a + ORG.front + ORG.notchY));
  plate = plate.subtract(CS().union(notches));
  let m = prism(plate, O.zp0, O.zp1);
  // Eje Ø3 a lo largo del borde, con cara plana sobre la cama.
  const axle = xCyl(p.ax0 ?? p.x0, p.ax1 ?? p.x1, ax.y, ax.z, ORG.rho, D.seg).trimByPlane([0, 0, 1], O.zp0);
  m = m.add(axle);
  // Faldones (uno por celda) con holgura deslizante y resaltes de clic.
  const skirts = [];
  const st = Math.max(0.9, 2 * D.lw);
  for (const i of p.cells) {
    const c = O.cells[i];
    const outer = cellCS(D, O, c, O.sealClr);
    const ring = outer.subtract(cellCS(D, O, c, O.sealClr + st));
    skirts.push(prism(ring, O.zp1 - 0.01, O.zp1 + ORG.skirtH));
    if (p.snapCells.includes(i)) {
      // Resalte triangular (45°) a media altura, en las caras ±X; si una de
      // ellas es la pared en diagonal del octógono, en las ±Y.
      const k = O.snap;
      const zm = O.zp1 + ORG.skirtH / 2;
      const cx0 = c.lim ? Math.max(c.x0, -c.lim) : c.x0, cx1 = c.lim ? Math.min(c.x1, c.lim) : c.x1;
      const inside = (x, y) => (D.cham > 0
        ? Math.abs(x) <= D.Li / 2 - Math.max(0, Math.abs(y) - (D.Wi / 2 - D.cham)) - 0.8 && Math.abs(y) <= D.Wi / 2 - 0.8
        : Math.abs(x) <= D.Li / 2 - 0.01) && (!c.lim || Math.abs(x) <= c.lim + k + 0.6);
      const hbx = Math.min(8, (c.y1 - c.y0) / 3), ym = (c.y0 + c.y1) / 2;
      const hby = Math.min(8, (cx1 - cx0) / 3), xm = (cx0 + cx1) / 2;
      const faceX = [[cx0 + O.sealClr, -1], [cx1 - O.sealClr, 1]];
      const okX = faceX.every(([xs, dir]) => inside(xs + dir * (k + 0.5), ym - hbx / 2) && inside(xs + dir * (k + 0.5), ym + hbx / 2));
      const tri = (dir) => poly([[-dir * 0.01, -k - 0.3], [dir * k, 0], [-dir * 0.01, k + 0.3]]);
      if (okX) {
        for (const [xs, dir] of faceX) {
          // Perfil en (x, z) extruido a lo largo de Y.
          skirts.push(tri(dir).extrude(hbx).rotate([90, 0, 0]).translate([xs, ym + hbx / 2, zm]));
        }
      } else {
        for (const [ys, dir] of [[c.y0 + O.sealClr, -1], [c.y1 - O.sealClr, 1]]) {
          if (!inside(xm - hby / 2, ys + dir * (k + 0.5)) || !inside(xm + hby / 2, ys + dir * (k + 0.5))) continue;
          // Perfil en (y, z) extruido a lo largo de X.
          skirts.push(tri(dir).extrude(hby).rotate([90, 0, 90]).translate([xm - hby / 2, ys, zm]));
        }
      }
    }
  }
  m = m.add(unionAll(skirts));
  // Pestaña para la uña en el borde libre.
  m = m.add(box(p.tab - ORG.tabW / 2, p.tab + ORG.tabW / 2, p.y1 - 0.01, p.y1 + ORG.tabL, O.zp0, O.zp1));
  return m;
}
