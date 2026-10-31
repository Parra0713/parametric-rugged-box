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

/** Pozos para el dedo (planta) y su zona descubierta. */
const wellCS = (w) => rectCS(w.x0, w.x1, w.y0, w.y1);
const wellOpenCS = (w) => rectCS(w.x0, w.x1, w.yTab, w.y1 + 1);

/** Celdas que tocan algún pozo: se recortan dejando un divisor alrededor. */
function wellKeepOut(O) {
  return O.wells.length ? CS().union(O.wells.map((w) => wellCS(w).offset(O.wd, 'Square'))) : null;
}

/** Contorno de una celda (recortado al interior de la caja: octógono, radios, pozos). */
function cellCS(D, O, c, inset = 0) {
  let cs = rrCS(c.x0 + inset, c.x1 - inset, c.y0 + inset, c.y1 - inset, Math.max(0.3, O.rc - inset), D.seg);
  cs = cs.intersect(rrOffset(D, -inset));
  if (c.lim) cs = cs.intersect(rectCS(-c.lim + inset, c.lim - inset, -D.Wi, D.Wi));
  if (c.cut) cs = cs.subtract(c.cut.offset(inset, 'Square'));
  return cs;
}

/** Marca las celdas que pisan un pozo (en la propia distribución, una vez). */
function markWellCells(D, O) {
  if (O._wellsMarked) return;
  O._wellsMarked = true;
  const ko = wellKeepOut(O);
  if (!ko) return;
  for (const c of O.cells) {
    const r = rectCS(c.x0, c.x1, c.y0, c.y1);
    if (!r.intersect(ko).isEmpty()) c.cut = ko;
  }
}

/**
 * Sección superior del fondo inclinado: la celda reducida `s`, salvo en los
 * lados contra la pared exterior, que bajan rectos (si no, entre el chaflán
 * y la ranura de desacople quedaba una cuña más fina que 2 líneas).
 */
function scoopTop(D, O, c, s, nearWall) {
  const top = cellCS(D, O, c, s);
  return nearWall ? top.add(cellCS(D, O, c, 0).intersect(nearWall)) : top;
}

/** Cilindro de eje X. */
const xCyl = (x0, x1, y, z, r, seg) => M().cylinder(x1 - x0, r, r, seg).rotate([0, 90, 0]).translate([x0, y, z]);

/**
 * Hueco de la tapa con organizador: la franja de las tapas interiores (del
 * borde a zp1) + cada celda con su fondo inclinado + la ranura que separa
 * divisores y carriles de la pared exterior. Sustituye a la cavidad normal:
 * así la tapa sale de UNA resta.
 *
 * Ranura de desacople: donde un divisor (o un carril) se funde con la pared
 * exterior, al enfriarse tira de ella y deja una marca vertical por fuera
 * (el "rechupe" frente a un nervio de las piezas inyectadas). Con una ranura
 * de 1 línea entre ambos el laminador los imprime por separado: el divisor
 * cuelga del techo y la pared queda lisa. Abajo (franja de las tapas
 * interiores) los bloques de pivote siguen unidos a la pared.
 */
export function orgCavity(D, zB) {
  const O = D.org;
  markWellCells(D, O);
  // Celdas iguales (lo normal) se construyen UNA vez y se copian: las copias
  // no se tocan entre sí, así que se juntan con compose (sin booleanos).
  // En la vista rápida se omite el fondo inclinado (detalle, no mecánica).
  const s = D.draft ? 0 : O.scoop;
  const shapes = new Map();
  const solids = [];
  const nearWall = rrOffset(D, 0).subtract(rrOffset(D, -(O.scoop + O.gap + 0.3)));
  for (const c of O.cells) {
    const w = c.x1 - c.x0, h = c.y1 - c.y0;
    c.atWall = !rectCS(c.x0, c.x1, c.y0, c.y1).intersect(nearWall).isEmpty();
    const clipped = c.lim || D.cham > 0 || c.cut || c.atWall;
    const key = clipped ? null : `${w.toFixed(3)}x${h.toFixed(3)}`;
    let solid = key && shapes.get(key);
    if (!solid) {
      const cc = clipped ? c : { ...c, x0: -w / 2, x1: w / 2, y0: -h / 2, y1: h / 2 };
      const Dl = clipped ? D : { ...D, cham: 0, Li: 1e4, Wi: 1e4 };
      // El fondo inclinado es la envolvente convexa entre dos secciones: se
      // hace con la celda sin muesca y luego se quita la muesca del pozo (la
      // envolvente de una celda con muesca la rellenaba).
      const ccFull = { ...cc, cut: null };
      const cs = cellCS(Dl, O, ccFull);
      const pr = prism(cs, O.zp1 - 0.5, O.zi - s + 0.01);
      solid = s > 0.3 ? pr.add(M().hull([prism(cs, O.zi - s, O.zi - s + 0.01), prism(scoopTop(Dl, O, ccFull, s, c.atWall ? nearWall : null), O.zi - 0.01, O.zi)])) : pr;
      if (c.cut) solid = solid.subtract(prism(c.cut, O.zp1 - 1, O.zi + 1));
      if (key) shapes.set(key, solid);
      else { solids.push(solid); continue; }
    }
    solids.push(solid.translate([(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, 0]));
  }
  // Ranura de desacople + esquinas de las celdas contra la pared en ángulo
  // recto (el redondeo dejaría una astilla entre él y la ranura).
  // (La ranura entra 0.01 mm en la pared para no dejar caras coplanarias
  // con las celdas; las esquinas, exactas: un divisor no puede adelgazar.)
  const band = rrOffset(D, 0.01).subtract(rrOffset(D, -O.gap));
  const sq = rrOffset(D, 0.01).subtract(rrOffset(D, -(O.rc + O.gap + 0.1)))
    .intersect(CS().union(O.cells.map((c) => {
      const r = rectCS(c.x0, c.x1, c.y0, c.y1);
      return c.cut ? r.subtract(c.cut) : r;
    })));
  return unionAll([prism(rrOffset(D, 0), zB - 1, O.zp1), M().compose(solids), prism(band.add(sq), O.zp1 - 0.01, O.zi - 0.6)]);
}

export function orgLidGeometry(D, opt = {}) {
  const O = D.org;
  if (opt.mechOnly) return orgMech(D);
  markWellCells(D, O);
  // Bloque: todo el interior de la tapa entre zp1 y el techo, menos las celdas.
  const block0 = prism(rrOffset(D, 0.01), O.zp1, O.zi + 0.01);
  const cuts = [];
  for (const c of O.cells) {
    const cf = { ...c, cut: null };
    const cs = cellCS(D, O, cf);
    const s = O.scoop;
    let cut = prism(cs, O.zp1 - 1, O.zi - s + 0.01);
    if (s > 0.3) cut = cut.add(M().hull([prism(cs, O.zi - s, O.zi - s + 0.01), prism(scoopTop(D, O, cf, s, rrOffset(D, 0).subtract(rrOffset(D, -(s + O.gap + 0.3)))), O.zi - 0.01, O.zi)]));
    cuts.push(c.cut ? cut.subtract(prism(c.cut, O.zp1 - 2, O.zi + 1)) : cut);
  }
  const block = block0.subtract(unionAll(cuts));
  const m = orgMech(D);
  return { add: m.add ? M().union([block, m.add]) : block, cut: m.cut };
}

/**
 * Perfil YZ de un bloque de pivote (u = Y, v = Z): de la punta de la gota del
 * agujero − 1 mm hasta zp1, con la esquina de abajo‑delante redondeada con
 * centro en el eje (por ahí barre el borde de la tapa interior al abrirse).
 */
function blockProfile(O, ax) {
  const R = O.blockR;
  const body = rectCS(ax.y - R, ax.y + R, O.zb, O.zp1 + 0.01);
  const keep = CS().union([
    CS().circle(R, 48).translate([ax.y, ax.z]),
    rectCS(ax.y - 20, ax.y, ax.z - 20, ax.z + 20),
    rectCS(ax.y - 20, ax.y + 20, ax.z, ax.z + 20),
  ]);
  return body.intersect(keep);
}

/**
 * Un bloque de pivote: macizo entre su cara (x0) y la pared (s = ±1) o, entre
 * celdas, entre x0 y x1 con agujero desde cada lado. Cada agujero: gota de
 * radio `a` (punta hacia −Z: arriba al imprimir boca abajo), profundidad hd.
 * Ranura de montaje desde +Y con `pinE − lip` de profundidad (chaflán de 45°
 * en su cara de −Z) y embocadura a 45° en planta: al empujar la tapa interior
 * hacia −Y el pivote se desliza por la ranura y salta (clic) a su agujero.
 */
function pivotBlock(D, O, b, seg) {
  const ax = b.axis;
  const R = O.blockR;
  const prof = blockProfile(O, ax);
  const faces = b.mid ? [[b.x0, 1], [b.x1, -1]] : [[b.x0, b.s]];   // [cara, sentido hacia dentro del bloque]
  const xA = b.mid ? b.x0 : b.s > 0 ? b.x0 : b.x0 - 30;
  const xB = b.mid ? b.x1 : b.s > 0 ? b.x0 + 30 : b.x0;
  let solid = yzExtrude(prof, xA, xB);
  // Bloque de pared: se recorta al interior y se funde con la pared.
  if (!b.mid) solid = solid.intersect(prism(rrOffset(D, 0.05), O.zb - 1, O.zp1 + 1));
  const cuts = [];
  const gd = ORG.pinE - O.lip;
  for (const [xf, s] of faces) {
    const x0 = s > 0 ? xf - 0.01 : xf - O.hd, x1 = s > 0 ? xf + O.hd : xf + 0.01;
    cuts.push(yzExtrude(teardrop(ax.y, ax.z, O.a, false, seg), x0, x1));
    // Ranura de entrada (sección XZ, extruida en Y desde el eje hasta la cara +Y).
    const xg = xf + s * gd;
    const sec = poly(s > 0
      ? [[xf - 0.01, ax.z - O.a - gd], [xg, ax.z - O.a], [xg, ax.z + O.a], [xf - 0.01, ax.z + O.a]]
      : [[xg, ax.z - O.a], [xf + 0.01, ax.z - O.a - gd], [xf + 0.01, ax.z + O.a], [xg, ax.z + O.a]]);
    // extrude (+Z) → rotate 90° en X: Z → −Y, Y → Z; se lleva a [ax.y, ax.y + R + 1].
    cuts.push(sec.extrude(R + 1).rotate([90, 0, 0]).translate([0, ax.y + R + 1, 0]));
    // Embocadura en planta: chaflán de 45° en la arista cara‑interior / cara +Y.
    const e = ORG.pinE;
    const yF = ax.y + R;
    const tri = poly(s > 0
      ? [[xf - 0.01, yF - e - 0.01], [xf - 0.01, yF + 0.01], [xf + e + 0.01, yF + 0.01]]
      : [[xf + 0.01, yF - e - 0.01], [xf - e - 0.01, yF + 0.01], [xf + 0.01, yF + 0.01]]);
    cuts.push(prism(tri, O.zb - 1, O.zp1 - 0.6));
  }
  // Los agujeros y ranuras se restan a toda la tapa (bloque y carril de
  // encima: el pivote sobresale por encima de zp1).
  return { solid, cut: unionAll(cuts) };
}

/** Bloques de pivote (se añaden), canales del eje y pozos para el dedo (se quitan). */
function orgMech(D) {
  const O = D.org;
  const adds = [];
  const lidCuts = [];
  if (!O.has) return { add: null, cut: null };
  markWellCells(D, O);
  // Canal del eje en el carril (el eje sobresale por encima de zp1), entre
  // las caras de los dos bloques de cada tapa interior (dentro de los bloques
  // el pivote va por su agujero cerrado y su ranura). Abierto hacia +Y
  // (ranura): la tapa interior se monta deslizándola hacia −Y y el eje tiene
  // que poder pasar bajo el carril y los divisores.
  // Grupos disjuntos (canales de cada tapa interior, cortes de cada bloque,
  // pozos) se juntan con compose: sin booleanos entre ellos.
  const slide = O.blockR + 2;
  const channels = [], blockCuts = [];
  for (const p of O.panels) {
    const ax = p.axis, x0 = p.pivots[0] - 0.05, x1 = p.pivots[1] + 0.05;
    channels.push(M().hull([xCyl(x0, x1, ax.y, ax.z, O.a, D.seg), xCyl(x0, x1, ax.y + slide, ax.z, O.a, D.seg)]));
  }
  lidCuts.push(M().compose(channels));
  // Bloques de pivote: los iguales (bloques entre celdas de una misma fila)
  // se construyen una vez y se copian.
  const mids = new Map();
  const solids = [];
  for (const b of O.blocks) {
    if (b.mid) {
      const k = `${b.axis.y}:${(b.x1 - b.x0).toFixed(3)}`;
      let ref = mids.get(k);
      if (!ref) { ref = pivotBlock(D, O, { ...b, x0: -(b.x1 - b.x0) / 2, x1: (b.x1 - b.x0) / 2 }, D.seg); mids.set(k, ref); }
      const dx = (b.x0 + b.x1) / 2;
      solids.push(ref.solid.translate([dx, 0, 0]));
      blockCuts.push(ref.cut.translate([dx, 0, 0]));
    } else {
      const pb = pivotBlock(D, O, b, D.seg);
      solids.push(pb.solid);
      blockCuts.push(pb.cut);
    }
  }
  lidCuts.push(M().compose(blockCuts));
  adds.push(M().compose(solids));
  // Pozos para el dedo: bolsillo de la franja hasta zp1 + h.
  if (O.wells.length) lidCuts.push(M().compose(O.wells.map((w) => prism(wellCS(w), O.zp1 - 0.6, O.zp1 + w.h))));
  return { add: M().compose(adds), cut: lidCuts.length ? unionAll(lidCuts) : null };
}

/** Planta de los bloques de pivote (para recortar las tapas interiores). */
function blocksPlan(O, b, yGrow = 0) {
  const ax = b.axis;
  const y0 = ax.y - O.blockR - 0.4, y1 = ax.y + O.blockR + ORG.notchY + yGrow;
  if (b.mid) return rectCS(b.x0 - ORG.notchX, b.x1 + ORG.notchX, y0, y1);
  return b.s > 0 ? rectCS(b.x0 - ORG.notchX, b.x0 + 40, y0, y1) : rectCS(b.x0 - 40, b.x0 + ORG.notchX, y0, y1);
}

/** Una tapa interior en su posición cerrada (marco interno). */
export function orgPanel(D, p) {
  const O = D.org;
  markWellCells(D, O);
  const ax = p.axis;
  // Placa: del eje al borde libre, recortada al interior de la caja.
  let plate = rectCS(p.x0, p.x1, ax.y, p.y1).intersect(rrOffset(D, D.cham > 0 ? -1.0 : -0.3));
  if (p.lim) plate = plate.intersect(rectCS(-p.lim, p.lim, -D.Wi, D.Wi));
  // Muescas: bloques de pivote (de todos los ejes que la pisen) y pozos
  // (el propio: la zona descubierta; los ajenos: entero).
  const cuts = O.blocks.map((b) => blocksPlan(O, b));
  for (const w of O.wells) cuts.push(w === p.well ? wellOpenCS(w) : wellCS(w).offset(0.4, 'Square'));
  plate = plate.subtract(CS().union(cuts));
  let m = prism(plate, O.zp0, O.zp1);
  // Eje Ø3 a lo largo del borde (pivote a pivote), con cara plana sobre la
  // cama; se interrumpe donde pasa un pozo ajeno.
  let axle = xCyl(p.ax0, p.ax1, ax.y, ax.z, ORG.rho, D.seg).trimByPlane([0, 0, 1], O.zp0);
  const others = O.wells.filter((w) => w !== p.well);
  if (others.length) axle = axle.subtract(prism(CS().union(others.map((w) => wellCS(w).offset(0.4, 'Square'))), O.zp0 - 1, O.zp1 + 5));
  // Punta de cada pivote con chaflán de 0.4 mm (entra mejor por la embocadura).
  const c0 = 0.4, rr = ORG.rho;
  const coneR = M().cylinder(c0, rr, rr - c0, D.seg).rotate([0, 90, 0]).translate([p.ax1 - c0, ax.y, ax.z]);
  const coneL = M().cylinder(c0, rr - c0, rr, D.seg).rotate([0, 90, 0]).translate([p.ax0, ax.y, ax.z]);
  axle = axle.subtract(xCyl(p.ax1 - c0, p.ax1 + 0.1, ax.y, ax.z, rr + 1, D.seg).subtract(coneR))
    .subtract(xCyl(p.ax0 - 0.1, p.ax0 + c0, ax.y, ax.z, rr + 1, D.seg).subtract(coneL));
  m = m.add(axle);
  // Faldones (uno por celda) con holgura deslizante y resaltes de clic.
  const skirts = [];
  const st = Math.max(0.9, 2 * D.lw);
  for (const i of p.cells) {
    const c = O.cells[i];
    const outer = cellCS(D, O, c, O.sealClr);
    const ring2 = outer.subtract(cellCS(D, O, c, O.sealClr + st));
    skirts.push(prism(ring2, O.zp1 - 0.01, O.zp1 + ORG.skirtH));
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
      // La base del resalte entra media pared en el faldón (unión segura aunque
      // el borde de la celda se haya recortado unas centésimas contra la pared).
      const tri = (dir) => poly([[-dir * st / 2, -k - 0.3 - st / 2], [dir * k, 0], [-dir * st / 2, k + 0.3 + st / 2]]);
      // Posición a lo largo de la cara: la central o, si ahí la celda tiene la
      // muesca de un pozo, la primera en la que el faldón existe de verdad.
      // Además, la punta del resalte debe quedar dentro del interior (las
      // esquinas redondeadas de la caja no son rectas).
      const interior = rrOffset(D, -0.02);
      const onRing = (r, tip) => ring2.intersect(r).area() > 0.98 * r.area() && interior.intersect(tip).area() > 0.98 * tip.area();
      const F = [0, -0.25, 0.25, -0.33, 0.33, -0.4, 0.4];
      const pickX = (xs, dir) => F.map((f) => ym + f * (c.y1 - c.y0)).find((yc) => onRing(
        rectCS(Math.min(xs, xs - dir * st * 0.8), Math.max(xs, xs - dir * st * 0.8), yc - hbx / 2, yc + hbx / 2),
        rectCS(Math.min(xs, xs + dir * (k + 0.3)), Math.max(xs, xs + dir * (k + 0.3)), yc - hbx / 2, yc + hbx / 2)));
      const pickY = (ys, dir) => F.map((f) => xm + f * (cx1 - cx0)).find((xc) => onRing(
        rectCS(xc - hby / 2, xc + hby / 2, Math.min(ys, ys - dir * st * 0.8), Math.max(ys, ys - dir * st * 0.8)),
        rectCS(xc - hby / 2, xc + hby / 2, Math.min(ys, ys + dir * (k + 0.3)), Math.max(ys, ys + dir * (k + 0.3)))));
      if (okX) {
        for (const [xs, dir] of faceX) {
          const yc = pickX(xs, dir);
          if (yc !== undefined) skirts.push(tri(dir).extrude(hbx).rotate([90, 0, 0]).translate([xs, yc + hbx / 2, zm]));
        }
      } else {
        for (const [ys, dir] of [[Math.max(c.y0, -D.Wi / 2) + O.sealClr, -1], [Math.min(c.y1, D.Wi / 2) - O.sealClr, 1]]) {
          const xc = pickY(ys, dir);
          if (xc === undefined || !inside(xc - hby / 2, ys + dir * (k + 0.5)) || !inside(xc + hby / 2, ys + dir * (k + 0.5))) continue;
          skirts.push(tri(dir).extrude(hby).rotate([90, 0, 90]).translate([xc - hby / 2, ys, zm]));
        }
      }
    }
  }
  m = m.add(unionAll(skirts));
  return m;
}
