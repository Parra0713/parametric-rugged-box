/**
 * gridfinity.js — Pies de anclaje Gridfinity (estándar de Zack Freedman).
 *
 * Perfil de un pie (desde la cama hacia arriba), celda de 42 mm:
 *   0.00 → 0.80 mm : chaflán 45°   35.6 → 37.2 mm   (r 0.8 → 1.6)
 *   0.80 → 2.60 mm : vertical      37.2 mm          (r 1.6)
 *   2.60 → 4.75 mm : chaflán 45°   37.2 → 41.5 mm   (r 1.6 → 3.75)
 * Encaja en cualquier placa base Gridfinity estándar.
 */
import { roundRect, prism, frustum, unionAll } from './geo.js';

export const GF_PITCH = 42;
export const GF_H = 4.75;

/** Un pie centrado en el origen, ocupando z ∈ [−4.75, 0]. */
function foot(seg) {
  const a = roundRect(35.6, 35.6, 0.8, seg);
  const b = roundRect(37.2, 37.2, 1.6, seg);
  const c = roundRect(41.5, 41.5, 3.75, seg);
  return unionAll([
    frustum(a, 0, b, 0.8),
    prism(b, 0.8, 2.6),
    frustum(b, 2.6, c, GF_H),
    prism(c, GF_H - 0.01, GF_H + 0.3),   // solape con el fondo de la caja
  ]).translate([0, 0, -GF_H]);
}

/** Matriz de pies nx × ny centrada bajo la caja. */
export function gridfinityFeet(D) {
  const f = foot(D.seg);
  const out = D.gfCells.map(([x, y]) => f.translate([x, y, 0]));
  return unionAll(out);
}
