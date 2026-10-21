/**
 * hinge.js — Bisagras de nudillos alternados (base / tapa / base …).
 *
 * Decisiones de diseño (todas en coordenadas de MUNDO, caja cerrada,
 * +Y = trasera, eje de giro paralelo a X):
 *
 * 1. Posición del eje: (ya, za) con za = Hb − tl, es decir, a la altura de la
 *    PUNTA de la lengüeta. Cinemática: un punto a altura c sobre el eje y a
 *    distancia horizontal a delante de él se mueve, para un giro pequeño θ,
 *    dz = a·θ (sube) y dy = c·θ. En la punta de la lengüeta c = 0 → sale
 *    vertical; en la raíz c = tl → desplazamiento máximo c·(b−c)/a ≈ tl²/4a
 *    ≈ 0.2 mm, absorbido por la conicidad de la lengüeta. Con el eje en la
 *    cara de unión (diseño ingenuo) la lengüeta rozaría la pared interior de
 *    la ranura ~1 mm y bloquearía la apertura.
 *
 * 2. Nudillos fuera de la banda con separación hGap: ningún punto de la tapa
 *    entra en el radio rk del eje en los tramos de la base, y viceversa. Se
 *    demuestra en el comentario de `lidLeafProfile`.
 *
 * 3. Imprimibilidad sin soportes: cada nudillo se une a la banda con un
 *    cartabón tangente a 45° en el lado que queda "abajo" en su orientación
 *    de impresión (base: abajo en mundo; tapa: arriba en mundo, porque se
 *    imprime boca abajo). El contorno del nudillo y el agujero son "teardrop"
 *    truncados en la misma dirección.
 *
 * 4. Número de nudillos impar: los extremos son de la base, de modo que la
 *    cabeza y la punta de presión del pasador apoyan en la pieza fija.
 */
import { CS, poly, circle, teardrop, yzExtrude, unionAll } from './geo.js';

/** Contorno exterior del nudillo: teardrop truncado (u = Y, v = Z). */
function knuckleOutline(D, up) {
  const td = teardrop(D.ya, D.za, D.rk, up, D.seg);
  // Truncado a 1.15·rk: el puente plano resultante es corto (< 2 mm).
  const s = up ? 1 : -1;
  const cut = CS().square([4 * D.rk, 4 * D.rk], true)
    .translate([D.ya, D.za + s * (1.15 * D.rk + 2 * D.rk)]);
  return td.subtract(cut);
}

/** Perfil (u = Y, v = Z) de un nudillo de la BASE con su cartabón. */
function baseLeafProfile(D) {
  // El cartabón llega hasta la cara de la PARED (no solo de la banda): su cara
  // inferior es una recta continua a 45° desde el nudillo hasta la pared, sin
  // entalladuras que concentren tensiones.
  const u0 = D.yb - D.bo - 0.8;
  const vLow = Math.max(0.4, D.za - (D.ya - u0) - D.rk * Math.SQRT2);
  const web = CS().hull([
    circle(D.ya, D.za, D.rk, D.seg),
    poly([[u0, D.Hb], [u0 - 0.01, D.Hb], [u0, vLow]]),
  ]);
  // El cartabón no sube por encima de la cara de unión (lo ocupa la tapa).
  const clip = CS().square([D.ya + D.rk * 3 - u0 + 2, D.Hb], false).translate([u0 - 1, 0]);
  return web.intersect(clip).add(knuckleOutline(D, false));
}

/**
 * Perfil de un nudillo de la TAPA.
 *
 * Prueba de no‑colisión al abrir (giro θ ∈ [0, π]): un punto de la tapa con
 * coordenadas relativas al eje (−a, c), a > 0, pasa a
 *   y' = −a·cosθ + c·sinθ,   z' = a·sinθ + c·cosθ.
 * Si θ ≤ π/2: z' ≥ min(a, c) ≥ tl siempre que a ≥ tl y c ≥ tl → queda sobre
 * la cara de unión. Si θ > π/2: y' > 0 → queda detrás del eje, donde la base
 * no tiene material en los tramos de la tapa. Por eso se recorta el cartabón
 * por debajo de Hb y por delante de yb + hGap. Entre yb + hGap y el eje, el
 * material por encima del eje (c ≥ 0) cumple y' ≥ ya − a ≥ yb + hGap, así que
 * nunca entra en la banda; el que queda por debajo del eje (c < 0) sí podría,
 * y se elimina (salvo el propio nudillo, que gira sobre sí mismo).
 */
function lidLeafProfile(D) {
  const u0 = D.yb - D.bo - 0.8;                // hasta la cara de la pared
  const vHigh = Math.min(D.Hb + D.Hl - 0.4, D.za + (D.ya - u0) + D.rk * Math.SQRT2);
  const web = CS().hull([
    circle(D.ya, D.za, D.rk, D.seg),
    poly([[u0, D.Hb], [u0 - 0.01, D.Hb], [u0, vHigh]]),
  ]);
  const keepOut = CS().square([D.yb + D.hGap - (u0 - 5), D.Hb - (D.za - 3 * D.rk)], false)
    .translate([u0 - 5, D.za - 3 * D.rk]);
  // Bajo el eje (c < 0) y fuera del nudillo, un punto de la tapa avanzaría
  // hacia la banda de la base al girar: se elimina ese material.
  const belowAxis = CS().square([D.ya - (u0 - 5), D.za - (D.za - 3 * D.rk)], false)
    .translate([u0 - 5, D.za - 3 * D.rk]);
  const top = CS().square([50, 50], false).translate([u0 - 5, D.Hb + D.Hl]);
  return web.subtract(keepOut).subtract(belowAxis).subtract(top).add(knuckleOutline(D, true));
}

/**
 * Tramos X de los nudillos de una bisagra centrada en xc.
 * @returns {{x0:number,x1:number,owner:'base'|'lid'}[]}
 */
export function knuckleSpans(D, xc) {
  const h = D.hinge;
  const spans = [];
  let x = xc - h.len / 2;
  for (let i = 0; i < h.nk; i++) {
    spans.push({ x0: x, x1: x + h.kl, owner: i % 2 === 0 ? 'base' : 'lid' });
    x += h.kl + D.ag;
  }
  return spans;
}

/** Sólidos de bisagra para base y tapa (sin agujeros) + taladros. */
export function hinges(D) {
  const bp = baseLeafProfile(D);
  const lp = lidLeafProfile(D);
  const baseParts = [];
  const lidParts = [];
  for (const xc of D.hinge.xs) {
    for (const s of knuckleSpans(D, xc)) {
      (s.owner === 'base' ? baseParts : lidParts)
        .push(yzExtrude(s.owner === 'base' ? bp : lp, s.x0, s.x1));
    }
  }
  // Taladros: teardrop hacia +Z (mundo) en la base, hacia −Z en la tapa,
  // ambos apuntando "arriba" en su orientación de impresión.
  const r = D.holeD / 2;
  const holes = (up) => unionAll(D.hinge.xs.map((xc) =>
    yzExtrude(teardrop(D.ya, D.za, r, up, D.seg), xc - D.hinge.len / 2 - 1, xc + D.hinge.len / 2 + 1)));
  return {
    base: unionAll(baseParts),
    lid: unionAll(lidParts),
    baseHoles: holes(true),
    lidHoles: holes(false),
  };
}
