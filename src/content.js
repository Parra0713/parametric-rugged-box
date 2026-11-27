/**
 * content.js — Contenedores a medida a partir del SVG calcado de la pieza real.
 *
 *  - Lee el SVG respetando sus unidades (mm, cm, in, pt, px a 96 ppp): un
 *    calco exportado 1:1 en mm llega con su tamaño real.
 *  - Calcula la envolvente convexa del contorno y el rectángulo de área
 *    mínima (calibres giratorios) → interior óptimo y giro del contenido.
 *  - Calcula cuánto se pueden recortar las esquinas a 45° (octógono) sin
 *    tocar el contenido + holgura.
 */
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { hull2D } from './bedfit.js';

const UNIT = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 1 };

/** Escala mm por unidad de usuario a partir de width/height y viewBox. */
function svgScale(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const m = /^([\d.]+)\s*([a-z%]*)$/i.exec((svg.getAttribute('width') || '').trim());
  if (!m || m[2] === '%') return { k: 1, note: 'sin unidades: se asumen mm' };
  const unit = m[2].toLowerCase();
  const wmm = Number(m[1]) * (UNIT[unit] ?? 1);
  if (vb.length === 4 && vb[2] > 0) return { k: wmm / vb[2], note: `${m[1]} ${unit || 'mm'}` };
  return { k: UNIT[unit] ?? 1, note: `${unit || 'mm'}` };
}

/**
 * @returns {{polys:number[][][], hull:number[][], w:number, h:number, note:string}}
 *   polígonos exteriores en mm, Y hacia arriba, centrados en su caja.
 */
export function parseContentSVG(text) {
  const { k, note } = svgScale(text);
  const data = new SVGLoader().parse(text);
  const polys = [];
  for (const path of data.paths) {
    for (const shape of SVGLoader.createShapes(path)) {
      const pts = shape.extractPoints(24).shape.map((p) => [p.x * k, -p.y * k]);
      if (pts.length >= 3) polys.push(pts);
    }
    // Trazos sin relleno (típico de un calco): se toman como contorno.
    const st = path.userData?.style || {};
    if ((st.fill === 'none' || st.fill === undefined) && !SVGLoader.createShapes(path).length) {
      for (const sp of path.subPaths) {
        const pts = sp.getPoints(24).map((p) => [p.x * k, -p.y * k]);
        if (pts.length >= 3) polys.push(pts);
      }
    }
  }
  if (!polys.length) throw new Error('err.svgNoClosed');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const cpolys = polys.map((p) => p.map(([x, y]) => [x - cx, y - cy]));
  const flat = new Float32Array(cpolys.flat().flatMap(([x, y]) => [x, y, 0]));
  return { polys: cpolys, hull: hull2D(flat), w: x1 - x0, h: y1 - y0, note };
}

/** Rectángulo de área mínima que contiene la envolvente (ángulo en grados). */
export function minAreaRect(hull) {
  let best = { area: Infinity };
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length];
    const ang = Math.atan2(by - ay, bx - ax);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of hull) {
      const u = c * x - s * y, v = s * x + c * y;
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    }
    const area = (x1 - x0) * (y1 - y0);
    if (area < best.area) best = { area, deg: (-ang * 180) / Math.PI, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  // Lado largo en X.
  if (best.h > best.w) best = { ...best, deg: best.deg + 90, w: best.h, h: best.w, cx: -best.cy, cy: best.cx };
  return best;
}

/**
 * Coloca el contenido: giro P.objRotate, centrado en el interior.
 * Devuelve polígonos en el marco del USUARIO y en el marco INTERNO.
 */
export function placeContent(raw, P) {
  if (!raw) return null;
  const a = (P.objRotate * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const rot = raw.polys.map((p) => p.map(([x, y]) => [c * x - s * y, s * x + c * y]));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of rot) for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const user = rot.map((p) => p.map(([x, y]) => [x - cx, y - cy]));
  const internal = P.innerW > P.innerL ? user.map((p) => p.map(([x, y]) => [y, -x])) : user;
  return { user, internal, w: x1 - x0, h: y1 - y0 };
}

/**
 * Recorte de esquina máximo (pierna del chaflán a 45°, en el interior Li×Wi)
 * que deja el contenido libre con la holgura `clr`.
 */
export function maxCornerCut(internalPolys, Li, Wi, clr) {
  let m = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    let best = -Infinity;
    for (const p of internalPolys) for (const [x, y] of p) best = Math.max(best, sx * x + sy * y);
    m = Math.min(m, Li / 2 + Wi / 2 - best - clr * Math.SQRT2);
  }
  return Math.max(0, Math.floor(m * 2) / 2);
}

/** ¿El contenido (+ holgura) cabe en el interior? */
export function contentFits(placed, P) {
  return placed.w + 2 * P.objClearance <= P.innerL + 1e-6 && placed.h + 2 * P.objClearance <= P.innerW + 1e-6;
}
