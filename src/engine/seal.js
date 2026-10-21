/**
 * seal.js — Unión tapa/base: ranuras, lengüetas y junta TPU.
 *
 * Geometría (sección transversal, la base abajo):
 *
 *            tapa
 *     ┌──────────────────┐
 *     │        ▄▄        │  ← lengüeta (tongue), con conicidad escalonada:
 *     └──────┐ ██ ┌──────┘     más estrecha en la punta para que la holgura
 *            │ ▀▀ │            crezca al entrar y nunca roce al abrir.
 *            │ ░░ │  ← junta TPU (gasket) comprimida un 20–30 %
 *            └────┘  ← ranura (groove/gland) en la base
 *
 * La tapa apoya cara contra cara sobre la base: ese contacto es el TOPE DURO
 * que fija la compresión de la junta exactamente al valor calculado, sin
 * depender de la fuerza del cierre.
 */
import { roundRect, prism, frustum } from './geo.js';

/** Contorno a una distancia `d` (hacia fuera) del rectángulo interior. */
export function rrOffset(D, d) {
  return roundRect(D.Li + 2 * d, D.Wi + 2 * d, D.ri + d, D.seg);
}

/** Anillo 2D entre dos offsets del interior. */
export function ring(D, dIn, dOut) {
  return rrOffset(D, dOut).subtract(rrOffset(D, dIn));
}

/**
 * Volumen a restar de la base: las ranuras, con un chaflán de entrada de 45°
 * en ambos bordes superiores. El chaflán cumple dos funciones:
 *  - guía la lengüeta al cerrar (autocentrado de la tapa);
 *  - absorbe el término de segundo orden del giro de la bisagra: al abrir,
 *    un punto a distancia a del eje se acerca a él a(1−cosθ) ≈ h²/2a mientras
 *    sube h. Ese desplazamiento ocurre justo en el borde superior de la ranura.
 */
export function grooveCut(D) {
  const ch = D.grooves.length > 1 ? 0.35 : 0.5;
  const zc = D.Hb - ch, zt = D.Hb + 0.01;
  return D.grooves.map((g) => {
    const a = g.off - g.w / 2, b = g.off + g.w / 2;
    const slot = prism(ring(D, a, b), D.Hb - D.gd, D.Hb + 1);
    const lead = frustum(rrOffset(D, b), zc, rrOffset(D, b + ch), zt)
      .subtract(frustum(rrOffset(D, a), zc, rrOffset(D, a - ch), zt));
    return slot.add(lead);
  });
}

/**
 * Lengüetas de la tapa (coordenadas de mundo, bajo la cara de unión z = Hb).
 * Tres escalones: 50 % del largo a ancho completo, 30 % a −0.2 mm, 20 % a
 * −0.4 mm. Equivale a una conicidad de ~6° sin necesitar un loft.
 */
export function tongues(D) {
  const out = [];
  for (const g of D.grooves) {
    const tw = g.w - 2 * D.clr;
    const steps = [[0.5, 0], [0.3, 0.2], [0.2, 0.4]];
    let z = D.Hb + 0.01;
    for (const [frac, shrink] of steps) {
      const w = tw - shrink;
      const h = D.tl * frac;
      out.push(prism(ring(D, g.off - w / 2, g.off + w / 2), z - h, z));
      z -= h;
    }
  }
  return out;
}

/** Junta TPU impresa (pieza independiente, plana sobre la cama). */
export function gasket(D) {
  if (D.sealMode !== 'tpu') return null;
  const g = D.grooves[0];
  return prism(ring(D, g.off - D.gkw / 2, g.off + D.gkw / 2), 0, D.gkh);
}
