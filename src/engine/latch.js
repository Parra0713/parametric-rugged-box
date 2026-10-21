/**
 * latch.js — Cierres de gancho EMPOTRADOS y autobloqueantes.
 *
 * Sección YZ (frente a la izquierda; s = distancia hacia fuera de la pared):
 *
 *            ┌┐ ← labio para la uña (sobresale 1.2 mm)
 *       ┌────┘│      mejilla de la tapa (chaflán 45° arriba)
 *       │ ▄▄▄▄│◄─ gancho: apoya 0.15 mm bajo la cara del retén (precarga)
 *       │ ████│◄─ retén: barra horizontal entre las dos mejillas (puente)
 *  ─────┼─────┼── cara de unión
 *       │  █  │◄─ placa del cierre, al ras de las mejillas
 *       │  ●  │◄─ barril + pasador, en un hueco bajo la banda
 *       └─────┘   mejilla/orejeta de la base (chaflán 45° abajo)
 *
 *  - Empotrado: la cara exterior de la placa coincide con la de las mejillas
 *    (sh), así el cierre queda protegido y no se engancha.
 *  - Corto: el barril sube hasta justo debajo del fondo de la ranura de la
 *    junta (se abre un hueco local en la banda), ~25 % más corto que un
 *    cierre colgado bajo la banda.
 *  - Autobloqueo: el centro del contacto gancho‑retén queda fuera del eje
 *    (skt calculado en params.js). La reacción de la junta empuja el cierre
 *    contra su tope; para abrirlo hay que comprimir más la junta.
 *  - Impresión: el cierre se imprime de lado (perfil sobre la cama); el retén
 *    de la tapa es un puente entre las mejillas (la tapa se imprime boca
 *    abajo) y el techo del hueco de la base es otro puente.
 */
import { CS, poly, circle, teardrop, yzExtrude, unionAll } from './geo.js';

const rect = (u0, u1, v0, v1) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);

/** Perfil del cierre en posición cerrada (u = Y, v = Z mundo). */
export function latchProfile(D) {
  const { sp, zp, rl, spi, sh, sb, zc, hh } = D;
  const barrel = circle(-sp, zp, rl, D.seg);
  // Brazo solo por encima del eje: al abrir, nada barre hacia la pared.
  const armHull = CS().hull([barrel, rect(-sh, -spi, zp, zp + rl)]);
  const arm = armHull.intersect(rect(-sh - 1, -sp + rl + 1, zp, zp + rl + 1)).add(barrel);
  const plate = rect(-sh, -spi, zp, zc + hh);
  const yIn = -(sb + 0.3);
  let hook = rect(-sh, yIn, zc, zc + hh);
  const ch = 0.35;
  hook = hook.subtract(poly([[yIn + 0.1, zc - 0.1], [yIn - ch, zc - 0.1], [yIn + 0.1, zc + ch]]));
  const lip = poly([[-sh + 0.01, zc + hh], [-sh - 1.2, zc + hh], [-sh - 1.2, zc + hh - 1.0], [-sh + 0.01, zc + hh - 2.2]]);
  return CS().union([arm, plate, hook, lip]).subtract(circle(-sp, zp, D.latchHoleD / 2, D.seg));
}

/** Mejilla de la base (orejeta que sostiene el barril). */
function baseCheekProfile(D) {
  const { sw, sh, zp, rl, Hb } = D;
  const u0 = -(sw - 0.3);
  const zbo = zp - rl - 1.0;                       // borde inferior exterior
  const zbi = zbo - (sh - sw + 0.3);               // 45° hacia la pared
  const p = poly([[u0, Hb], [-sh + 0.6, Hb], [-sh, Hb - 0.6], [-sh, zbo], [u0, zbi]]);
  return p.intersect(rect(-sh - 1, u0 + 1, 0, Hb + 1));
}

/** Mejilla de la tapa. */
function lidCheekProfile(D) {
  const { sw, sh, zkt, hh, Hb, Hl } = D;
  const u0 = -(sw - 0.3);
  const zct = zkt + hh - 1.2;
  const p = poly([[u0, Hb], [-sh, Hb], [-sh, zct], [u0, zct + (sh - sw + 0.3)]]);
  return p.intersect(rect(-sh - 1, u0 + 1, Hb - 1, Hb + Hl - 0.01));
}

/** Retén: barra con chaflán de entrada en la arista exterior superior. */
function keeperProfile(D) {
  const { sb, skt, kc, kth, zkt } = D;
  return poly([
    [-(sb - 0.5), zkt], [-(skt - kc), zkt], [-skt, zkt - kc],
    [-skt, zkt - kth], [-(sb - 0.5), zkt - kth],
  ]);
}

/**
 * Geometría de cierres.
 * @returns {{lugs, lugHoles, pockets, lidCheeks, keepers, latch}}
 */
export function latches(D) {
  const bc = baseCheekProfile(D), lc = lidCheekProfile(D), kp = keeperProfile(D);
  const w = D.latchW;
  const lugs = [], lidCheeks = [], keepers = [], holes = [], pockets = [];
  for (const xc of D.latch.xs) {
    const a = xc - w / 2 - D.ag, b = xc + w / 2 + D.ag;
    for (const [x0, x1] of [[a - D.cheekW, a], [b, b + D.cheekW]]) {
      lugs.push(yzExtrude(bc, x0, x1));
      lidCheeks.push(yzExtrude(lc, x0, x1));
    }
    keepers.push(yzExtrude(kp, a - D.cheekW, b + D.cheekW));
    holes.push(yzExtrude(teardrop(-D.sp, D.zp, D.latchHoleD / 2, true, D.seg), a - D.cheekW - 1, b + D.cheekW + 1));
    // Hueco para el barril bajo el fondo de la ranura (entre las mejillas).
    pockets.push(yzExtrude(rect(-D.sh - 2, -(D.sw + 0.3), D.zp - D.rl - 1.2, D.Hb - D.gd - 0.5), a, b));
  }
  return {
    lugs: unionAll(lugs),
    lugHoles: unionAll(holes),
    pockets: unionAll(pockets),
    lidCheeks: unionAll(lidCheeks),
    keepers: unionAll(keepers),
    latch: yzExtrude(latchProfile(D), -w / 2, w / 2),
  };
}

