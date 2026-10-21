/**
 * pattern.js — Patrones artísticos de la tapa y logo SVG.
 *
 * La tapa se imprime BOCA ABAJO: la cara decorada queda contra la cama y sale
 * con el acabado de la placa (PEI texturizado, liso, etc.).
 *
 *  - Grabado (engrave, recomendado): las celdas son cavidades. Su "techo" se
 *    imprime como puente; con celdas ≤ ~15 mm el puente es limpio.
 *  - Relieve (emboss): los nervios sobresalen. Se añade SIEMPRE un marco
 *    perimetral para que la tapa apoye plana; la superficie entre nervios se
 *    imprime como puente, así que solo es recomendable con patrones densos.
 *
 * Todo se trabaja en 2D (CrossSection) y se extruye una única vez: es la
 * forma más barata de generar cientos de celdas.
 */
import { CS, poly, prism, unionAll } from './geo.js';
import { rrOffset } from './seal.js';

/** Región útil de la cara superior. */
export function patternArea(D, P) {
  return rrOffset(D, D.t - P.patternMargin);
}

/** Celdas hexagonales (hexágono de lados planos arriba/abajo). */
function hexCells(D, P, area) {
  const s = P.patternSize;                 // distancia entre caras de la teselación
  const R = s / Math.sqrt(3);              // circunradio de la teselación
  const rc = (s - P.patternRib) / Math.sqrt(3);
  if (rc <= 0.3) return null;
  const hex = CS().circle(rc, 6);
  const L = D.Li + 2 * D.t, W2 = D.Wi + 2 * D.t;
  const dx = 1.5 * R, dy = s;
  const nx = Math.ceil(L / 2 / dx) + 1, ny = Math.ceil(W2 / 2 / dy) + 1;
  const cells = [];
  for (let i = -nx; i <= nx; i++) {
    const off = (Math.abs(i) % 2) * dy / 2;
    for (let j = -ny; j <= ny; j++) cells.push(hex.translate([i * dx, j * dy + off]));
  }
  const full = (3 * Math.sqrt(3) / 2) * rc * rc;
  return filterSmall(CS().compose(cells).intersect(area.offset(-P.patternRib, 'Round', 2, 24)), full * 0.3);
}

/** Estriado: ranuras paralelas a `stripeAngle`. */
function stripeCells(D, P, area) {
  const p = P.patternSize, w = p - P.patternRib;
  if (w <= 0.3) return null;
  const diag = Math.hypot(D.Li, D.Wi) + 4 * D.t + 10;
  const n = Math.ceil(diag / 2 / p) + 1;
  const bars = [];
  for (let k = -n; k <= n; k++) bars.push(CS().square([diag * 2, w], true).translate([0, k * p]));
  const st = CS().compose(bars).rotate(P.stripeAngle);
  return filterSmall(st.intersect(area.offset(-P.patternRib, 'Round', 2, 24)), w * w);
}

/**
 * Reforzado cruzado: nervios diagonales (×1.5), cruz central y un anillo
 * interior. Imita las tapas nervadas de las cajas de herramientas: los
 * nervios diagonales rigidizan la placa frente a torsión.
 */
function crossCells(D, P, area) {
  const rib = P.patternRib;
  const inner = area.offset(-rib, 'Round', 2, 24);
  const b = inner.bounds();
  const L = b.max[0] - b.min[0], W2 = b.max[1] - b.min[1];
  if (L < 4 * rib || W2 < 4 * rib) return null;
  const bar = (len, w, ang) => CS().square([len, w], true).rotate(ang);
  const diagLen = Math.hypot(L, W2) + 10;
  const ang = Math.atan2(W2, L) * 180 / Math.PI;
  const ribs = [
    bar(diagLen, rib * 1.5, ang), bar(diagLen, rib * 1.5, -ang),
    bar(L + 10, rib, 0), bar(rib, W2 + 10, 0),
  ];
  // Anillo interior (si cabe).
  const k = Math.min(L, W2) * 0.18;
  if (k > 3 * rib) {
    const a = inner.offset(-k, 'Round', 2, 24);
    ribs.push(a.subtract(a.offset(-rib, 'Round', 2, 24)));
  }
  return filterSmall(inner.subtract(CS().union(ribs)), rib * rib * 4);
}

/** Elimina astillas: islas con área menor a `minArea`. */
function filterSmall(cs, minArea) {
  const parts = cs.decompose().filter((p) => p.area() >= minArea);
  return parts.length ? CS().compose(parts) : null;
}

/**
 * Construye el logo a partir de los datos preprocesados en el hilo principal
 * (svg.js): rellenos como polígonos con agujeros y trazos como polilíneas con
 * grosor. Todo ya está escalado a mm y colocado en coordenadas de la tapa.
 */
export function logoSection(svg) {
  if (!svg) return null;
  const parts = [];
  for (const sh of svg.fills || []) {
    if (!sh.outer || sh.outer.length < 3) continue;
    parts.push(CS().ofPolygons([sh.outer, ...(sh.holes || [])], 'EvenOdd'));
  }
  for (const st of svg.strokes || []) {
    const r = st.width / 2;
    if (r <= 0.05) continue;
    const pts = st.points;
    for (let i = 0; i < pts.length; i++) {
      parts.push(CS().circle(r, 12).translate(pts[i]));
      if (i > 0) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
        if (l < 1e-6) continue;
        const nx = (-dy / l) * r, ny = (dx / l) * r;
        parts.push(poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]));
      }
    }
  }
  if (!parts.length) return null;
  return CS().union(parts);
}

/**
 * Relieve final de la tapa (coordenadas de mundo).
 * @returns {{cut: Manifold|null, add: Manifold|null, warn: string[]}}
 */
export function lidRelief(D, P, svg) {
  const warn = [];
  const area = patternArea(D, P);
  const zTop = D.Hb + D.Hl;
  let cells = null;
  if (D.pattern === 'hex') cells = hexCells(D, P, area);
  else if (D.pattern === 'stripes') cells = stripeCells(D, P, area);
  else if (D.pattern === 'cross') cells = crossCells(D, P, area);

  let logo = logoSection(svg);
  if (logo) logo = logo.intersect(area);
  if (logo && logo.isEmpty()) logo = null;
  if (logo && cells) cells = cells.subtract(logo.offset(P.patternRib, 'Round', 2, 16));

  if (D.relief === 'engrave') {
    const region = unionAll([cells, logo]);
    if (!region || region.isEmpty()) return { cut: null, add: null, warn };
    return { cut: prism(region, zTop - D.pd, zTop + 1), add: null, warn };
  }
  // Relieve: marco perimetral + nervios + logo.
  let raised;
  if (cells) {
    const keep = logo ? logo.offset(P.patternRib, 'Round', 2, 16) : null;
    raised = area.subtract(cells);
    if (keep) raised = raised.subtract(keep);
  } else {
    raised = area.subtract(area.offset(-Math.max(2, P.patternRib * 1.5), 'Round', 2, 24));
    warn.push('Relieve sin patrón: la tapa solo apoya en el marco y el interior se imprime como puente largo. Usa "Grabado" o un patrón denso.');
  }
  if (cells && P.patternSize > 18) warn.push('Celdas grandes en relieve: puentes > 15 mm en la primera capa sobre la cama.');
  if (logo) raised = raised.add(logo);
  return { cut: null, add: prism(raised, zTop - 0.01, zTop + D.pd), warn };
}
