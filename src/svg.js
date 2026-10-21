/**
 * svg.js — Importación de SVG para la tapa (hilo principal).
 *
 * El análisis del SVG necesita DOMParser, que no existe en un Web Worker, así
 * que se hace aquí con el SVGLoader de three.js y al motor solo se le envían
 * polígonos planos ya en milímetros (datos pequeños y transferibles).
 *
 *  - Rellenos: SVGLoader.createShapes respeta fill-rule y agujeros.
 *  - Trazos (fill="none"): se convierten en polilíneas con grosor; el motor
 *    las engorda con segmentos + uniones redondas.
 */
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

/** Convierte el texto SVG en contornos en unidades del SVG (Y hacia arriba). */
export function parseSVG(text) {
  const data = new SVGLoader().parse(text);
  const fills = [], strokes = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const path of data.paths) {
    const st = path.userData?.style || {};
    const hasFill = st.fill !== undefined && st.fill !== 'none' && st.fill !== 'transparent';
    const hasStroke = st.stroke !== undefined && st.stroke !== 'none' && Number(st.strokeWidth) > 0;
    if (hasFill || (!hasFill && !hasStroke)) {
      for (const shape of SVGLoader.createShapes(path)) {
        const ex = shape.extractPoints(16);
        const outer = ex.shape.map((p) => [p.x, -p.y]);
        if (outer.length < 3) continue;
        outer.forEach(([x, y]) => grow(x, y));
        fills.push({ outer, holes: ex.holes.map((h) => h.map((p) => [p.x, -p.y])) });
      }
    }
    if (hasStroke) {
      for (const sp of path.subPaths) {
        const pts = sp.getPoints(16).map((p) => [p.x, -p.y]);
        if (pts.length < 2) continue;
        pts.forEach(([x, y]) => grow(x, y));
        strokes.push({ points: pts, width: Number(st.strokeWidth) });
      }
    }
  }
  if (!fills.length && !strokes.length) throw new Error('El SVG no contiene formas utilizables.');
  return { fills, strokes, bbox: { x0, y0, x1, y1 } };
}

/**
 * Escala, gira y coloca el SVG sobre la tapa (mm, coordenadas de mundo vistas
 * desde arriba). El ancho final es `svgSize` % del ancho útil del área.
 */
export function placeSVG(raw, P) {
  if (!raw) return null;
  const { x0, y0, x1, y1 } = raw.bbox;
  const w = x1 - x0, h = y1 - y0;
  const areaL = P.innerL + 2 * (P.wall - P.patternMargin);
  const areaW = P.innerW + 2 * (P.wall - P.patternMargin);
  // Ajuste para que quepa en el área (por ancho y por alto).
  const k = Math.min((areaL * P.svgSize) / 100 / w, (areaW * P.svgSize) / 100 / h);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const a = (P.svgRotate * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const tf = ([x, y]) => {
    const u = (x - cx) * k, v = (y - cy) * k;
    return [c * u - s * v + P.svgOffsetX, s * u + c * v + P.svgOffsetY];
  };
  return {
    fills: raw.fills.map((f) => ({ outer: f.outer.map(tf), holes: f.holes.map((hh) => hh.map(tf)) })),
    strokes: raw.strokes.map((st) => ({ points: st.points.map(tf), width: st.width * k })),
  };
}
