/**
 * pins.js — Pasadores impresos y tapones para pasador de filamento.
 *
 * Pasador impreso (clases M y L), en su orientación de impresión:
 *
 *    cabeza        cuerpo (perfil "D")              punta partida
 *    ┌──┐────────────────────────────────────┬──────────╲
 *    │  │                                    │ ranura   ▶  dientes ±Y
 *    └──┘────────────────────────────────────┴──────────╱
 *    ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ cara plana sobre la cama ▔▔▔▔▔▔▔▔▔▔▔▔▔
 *
 *  - Acostado: las capas recorren el pasador → trabaja a flexión dentro de
 *    las capas, no entre ellas.
 *  - La ranura es vertical: las dos patas flexionan en el plano de la cama
 *    (XY), donde el plástico es más elástico y no se delamina.
 *  - Dientes con rampa de entrada y hombro recto: entran a presión y no
 *    salen sin pellizcar las patas.
 *
 * Pasador de filamento (clase S): trozo de filamento 1.75 mm + dos tapones
 * impresos a presión (agujero ciego de 1.70 mm). Cero tornillería.
 */
import { M } from './geo.js';

// Matriz (u,v,w) → (y,z,x): el eje Z de un cilindro pasa a ser X.
const ZX = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];

function xCyl(x0, len, r0, r1, seg) {
  return M().cylinder(len, r0, r1, seg).transform(ZX).translate([x0, 0, 0]);
}

/**
 * Pasador impreso que atraviesa un tramo de longitud `span`.
 * Origen: cara interna de la cabeza en x = 0, eje en y = 0; apoyado en z = 0.
 */
export function printedPin(D, span, pinD = D.pinD) {
  const rp = pinD / 2;
  const seg = D.seg;
  const headT = Math.max(1.6, 0.45 * pinD);
  const barbH = 1.2;                               // longitud de la rampa
  const barb = D.clr + 0.4;                        // sobresale 0.4 mm del taladro
  const Lp = span + barbH + 0.3;                   // el hombro sale 0.3 mm
  const body = xCyl(0, Lp, rp, rp, seg);
  const head = xCyl(-headT, headT, rp * 1.75, rp * 1.75, seg);
  // Rampa: ancha en el hombro (x = Lp − barbH), estrecha en la punta.
  let teeth = xCyl(Lp - barbH, barbH, rp + barb, rp - 0.2, seg);
  // Dientes solo en ±Y: se recortan en Z para que la flexión sea en el plano.
  teeth = teeth.intersect(M().cube([barbH + 1, 4 * rp, 1.1 * rp], true)
    .translate([Lp - barbH / 2, 0, 0]));
  let pin = M().union([body, head, teeth]);
  // Ranura vertical que separa las dos patas.
  const sw = Math.max(0.9, 0.3 * pinD);
  const slotL = Math.min(2.5 * pinD, span * 0.5);
  pin = pin.subtract(M().cube([slotL + 1, sw, 4 * rp], true)
    .translate([Lp - slotL / 2 + 0.5, 0, 0]));
  // Cara plana: se recorta el 12 % del diámetro y se apoya en z = 0.
  const flat = -rp + 0.12 * pinD;
  pin = pin.trimByPlane([0, 0, 1], flat).translate([0, 0, -flat]);
  return { solid: pin, length: Lp + headT };
}

/** Tapón a presión para el pasador de filamento (agujero ciego). */
export function filamentCap(D) {
  const outer = M().cylinder(2.4, 2.6, 2.6, D.seg);
  const hole = M().cylinder(2.0, D.capHoleD / 2, D.capHoleD / 2, D.seg).translate([0, 0, 0.6]);
  // Chaflán de entrada para guiar el filamento.
  const lead = M().cylinder(0.4, D.capHoleD / 2, D.capHoleD / 2 + 0.3, D.seg).translate([0, 0, 2.0001]);
  return outer.subtract(hole).subtract(lead);
}

/** Longitud de filamento a cortar para un tramo. */
export function filamentLength(span) {
  return Math.round((span + 2 * 1.6) * 10) / 10;
}

