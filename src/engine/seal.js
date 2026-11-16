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
import { roundRect, prism, frustum, CS, pin } from './geo.js';
import { octagonPts } from './params.js';

/**
 * Contorno a una distancia `d` (hacia fuera) de la forma interior.
 * La forma interior es un rectángulo redondeado o, con esquinas recortadas
 * (D.cham > 0), un octógono alargado con los vértices redondeados (radio ri).
 * TODO el modelo (paredes, banda, ranura, junta, tapa, patrón, apilado) se
 * construye con offsets de esta forma, así que el octógono se propaga solo.
 */
const shapeCache = new WeakMap();
export function rrOffset(D, d) {
  if (!(D.cham > 0)) return roundRect(D.Li + 2 * d, D.Wi + 2 * d, D.ri + d, D.seg);
  let base = shapeCache.get(D);
  if (!base) {
    const oct = CS().ofPolygons([octagonPts(D.Li, D.Wi, D.cham)], 'NonZero');
    // Se reutiliza en toda la construcción: fuera de las liberaciones
    // anticipadas (si no, la tapa usaría una forma ya liberada por la base).
    base = pin(oct.offset(-D.ri, 'Miter', 4).offset(D.ri, 'Round', 2, D.seg));
    shapeCache.set(D, base);
  }
  return Math.abs(d) < 1e-9 ? base.translate([0, 0]) : base.offset(d, 'Round', 2, D.seg);
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
  const chIn = D.grooves.length > 1 ? 0.35 : 0.5;
  const zt = D.Hb + 0.01;
  return D.grooves.map((g) => {
    const a = g.off - g.w / 2, b = g.off + g.w / 2;
    // Borde exterior: la lengüeta se acerca a él a·(1−cosθ) ≈ tl²/2a al abrir,
    // con a = distancia al eje de la bisagra. En cajas pequeñas (eje cerca) el
    // chaflán se agranda lo necesario (antes rozaba en laberinto + clase S).
    const dist = Math.max(1, D.ya - (D.Wi / 2 + b));
    const chOut = Math.min(1.2, Math.max(chIn, (D.tl * D.tl) / (2 * dist) - D.sealClr + 0.15));
    const slot = prism(ring(D, a, b), D.Hb - D.gd, D.Hb + 1);
    const z0 = D.Hb - Math.max(chOut, chIn) - 0.01;
    const outerCone = frustum(rrOffset(D, b), D.Hb - chOut, rrOffset(D, b + chOut), zt)
      .add(prism(rrOffset(D, b), z0, D.Hb - chOut + 0.01));
    const innerKeep = frustum(rrOffset(D, a), D.Hb - chIn, rrOffset(D, a - chIn), zt)
      .add(prism(rrOffset(D, a), z0 - 0.01, D.Hb - chIn + 0.01));
    const lead = outerCone.subtract(innerKeep);
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
    const tw = g.w - 2 * D.sealClr;
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

/** Franjas 2D de ancho w en las posiciones de los nervios de apilado. */
export function stackLines(D, w, len) {
  const st = [];
  for (const x of D.stackRibs.xs) st.push(CS().square([w, len], true).translate([x, 0]));
  for (const y of D.stackRibs.ys) st.push(CS().square([len, w], true).translate([0, y]));
  return st.length ? CS().union(st) : null;
}

