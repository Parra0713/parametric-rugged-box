/**
 * latch.js — Cierres frontales de gancho con auto‑bloqueo.
 *
 * Esquema (sección YZ, frente de la caja a la izquierda, −Y):
 *
 *        ┌─┐ ← pestaña para la uña
 *        │ └──┐   gancho (asienta 0.15 mm por debajo del retén = precarga)
 *        │ ┌┐ ▼▄▄  retén de la tapa (chaflán 45° = rampa de entrada)
 *        │ ││ █ tapa
 *        │ ││─┼──── cara de unión
 *        │ ││ █ banda de la base
 *        │ ││  ╲
 *        └─●┘   ← barril con pasador, POR DENTRO de la cara de la banda
 *          orejetas en la base
 *
 * Principio mecánico: el eje (yp) está más hacia el interior que el punto de
 * contacto gancho–retén. La reacción de la junta (hacia arriba) genera un par
 * que CIERRA el cierre contra su tope, nunca lo abre. Para abrir hay que
 * girarlo hacia fuera, lo que obliga al gancho a bajar (cos φ decrece) y
 * comprimir aún más la junta: hay una barrera de energía → no se abre solo.
 *
 * Orientación de impresión: el cierre es un perfil 2D extruido, así que se
 * imprime ACOSTADO sobre su cara lateral. Las capas son paralelas al perfil
 * y la flexión de la placa ocurre dentro de cada capa (máxima resistencia).
 * El agujero del barril queda vertical y perfectamente redondo.
 */
import { CS, poly, circle, teardrop, yzExtrude, unionAll } from './geo.js';

/** Perfil del cierre en posición cerrada (u = Y, v = Z mundo, sin z0). */
export function latchProfile(D) {
  const { yp, zp, rl, ypi, lt, yfb, zkt, pre } = D;
  const zc = zkt - pre;                     // cara de agarre del gancho
  const hh = Math.max(2.4, lt);             // espesor del gancho
  const yIn = yfb - 0.3;                    // extremo interior del gancho
  const rect = (u0, u1, v0, v1) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  const barrel = circle(yp, zp, rl, D.seg);
  const arm = CS().hull([barrel, rect(ypi - lt, ypi, zp - rl, zp + rl)]);
  const plate = rect(ypi - lt, ypi, zp, zc + hh);
  let hook = rect(ypi - lt, yIn, zc, zc + hh);
  // Chaflán de entrada en la arista inferior interior del gancho.
  const ch = 0.35;
  hook = hook.subtract(poly([[yIn + 0.1, zc - 0.1], [yIn - ch, zc - 0.1], [yIn + 0.1, zc + ch]]));
  // Pestaña exterior para abrir con el dedo, con chaflán inferior de 45°.
  const tab = poly([
    [ypi - lt + 0.01, zc + hh], [ypi - lt - 3, zc + hh],
    [ypi - lt - 3, zc + hh - 1.2], [ypi - lt + 0.01, zc + hh - 4.2]]);
  let p = CS().union([arm, plate, hook, tab]);
  p = p.subtract(circle(yp, zp, D.holeD / 2, D.seg));
  return p;
}

/** Perfil de las orejetas de la base que sostienen el barril. */
function lugProfile(D) {
  const { yp, zp, rl, yw } = D;
  const uW = yw + 0.3;                       // 0.3 mm dentro de la pared
  const vTop = D.Hb - D.bandH - D.bo + 0.6;  // se funde con el chaflán de banda
  const vBot = Math.max(0.4, zp - (uW - yp) - rl * Math.SQRT2);
  const outline = teardrop(yp, zp, rl, false, D.seg);   // apunta abajo
  const cut = CS().square([4 * rl, 4 * rl], true).translate([yp, zp - 1.15 * rl - 2 * rl]);
  // Tres anclajes: dentro de la pared (arriba y abajo, chaflán de 45°) y el
  // borde inferior de la banda, para que la orejeta no deje entalladura.
  return CS().hull([outline.subtract(cut),
    poly([[uW, vTop], [uW, vBot], [uW + 0.01, vBot]]),
    poly([[D.yfb + 0.3, D.Hb - D.bandH], [D.yfb + 0.31, D.Hb - D.bandH], [D.yfb + 0.3, D.Hb - D.bandH - 0.01]])]);
}

/** Perfil del retén de la tapa (mundo). */
function keeperProfile(D) {
  const { yfb, kd, kc, zkt } = D;
  const kh = Math.max(0.6, zkt - kc - (kd + 0.5) - (D.Hb + 0.3));
  return poly([
    [yfb + 0.5, zkt],
    [yfb - kd + kc, zkt],
    [yfb - kd, zkt - kc],
    [yfb - kd, zkt - kc - kh],
    [yfb + 0.5, zkt - kc - kh - kd - 0.5],
  ]);
}

/**
 * Geometría de cierres.
 * @returns {{lugs, lugHoles, keepers, latch, pivots:{x:number}[]}}
 */
export function latches(D) {
  const lug = lugProfile(D);
  const keeper = keeperProfile(D);
  const lugs = [], keepers = [], holes = [];
  const w = D.latchW;
  for (const xc of D.latch.xs) {
    const a = xc - w / 2 - D.ag;          // borde interior de la orejeta izq.
    const b = xc + w / 2 + D.ag;
    lugs.push(yzExtrude(lug, a - D.lugL, a));
    lugs.push(yzExtrude(lug, b, b + D.lugL));
    keepers.push(yzExtrude(keeper, xc - w / 2 - 1, xc + w / 2 + 1));
    holes.push(yzExtrude(teardrop(D.yp, D.zp, D.holeD / 2, true, D.seg),
      a - D.lugL - 1, b + D.lugL + 1));
  }
  // Una sola pieza de cierre centrada en x = 0 (el visor la instancia).
  const latch = yzExtrude(latchProfile(D), -w / 2, w / 2);
  return {
    lugs: unionAll(lugs),
    lugHoles: unionAll(holes),
    keepers: unionAll(keepers),
    latch,
  };
}
