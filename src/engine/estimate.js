/**
 * estimate.js — Gramos "de laminador": cuánto filamento gasta de verdad una
 * pieza con unos ajustes de impresión dados, no su volumen macizo.
 *
 * Reproduce, capa a capa, lo que hace un laminador (PrusaSlicer, Orca):
 *   1. Corta la pieza (en su orientación de impresión) a media altura de
 *      cada capa.
 *   2. Perímetros: anillo de `perimeters` líneas por dentro del contorno.
 *      Lo que no cabe en ese anillo ya es pared maciza (pared de 4 líneas
 *      con 4 perímetros = todo perímetro, sin relleno).
 *   3. Capas sólidas: un punto del interior es sólido si en alguna de las
 *      `topBottom` capas de arriba o de abajo queda fuera de la pieza (fondo,
 *      techo y cualquier escalón). Así se detectan también los techos de
 *      celdas, cubiertas de insertos, etc.
 *   4. El resto es relleno disperso al `infill` (fracción de volumen; en
 *      giroide la fracción de volumen ≈ el porcentaje).
 * Densidad por defecto: PLA 1.24 g/cm³.
 */
import { M } from './geo.js';

/**
 * @param solid Manifold en orientación de impresión (z ≥ 0)
 * @param o { lw, lh, perimeters, topBottom, infill, density }
 * @returns { g, perimeter, solid, sparse } en gramos y `min`: minutos de
 *   impresión aproximados (velocidades típicas, sin aceleraciones; sirve para
 *   comparar variantes, no como el tiempo exacto del laminador)
 */
export function sliceEstimate(solid, o) {
  const { lw = 0.45, lh = 0.2, perimeters = 4, topBottom = 5, infill = 0.15, density = 1.24 } = o;
  const bb = solid.boundingBox();
  const z0 = bb.min[2], n = Math.max(1, Math.round((bb.max[2] - z0) / lh));
  const cs = [];
  for (let i = 0; i < n; i++) cs.push(solid.slice(z0 + (i + 0.5) * lh));
  // Interior tras los perímetros (offset hacia dentro con aristas rectas, como
  // el relleno real; el redondeo apenas cambia el área).
  const inner = cs.map((c) => c.offset(-perimeters * lw, 'Miter', 2));
  let per = 0, sol = 0, spa = 0, sec = 0;
  const sp = { outer: 100, inner: 150, solid: 180, sparse: 250, layer: 0.6, ...(o.speeds || {}) };
  const contour = (c) => {
    let L = 0;
    for (const poly of c.toPolygons()) for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      L += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return L;
  };
  for (let i = 0; i < n; i++) {
    const A = cs[i].area(), Ai = inner[i].area();
    per += A - Ai;
    // Tiempo (relativo, sin aceleraciones): contorno exterior a velocidad de
    // perímetro exterior, el resto de perímetros, sólido y relleno.
    const Lc = contour(cs[i]), Lp = (A - Ai) / lw;
    sec += sp.layer + Math.min(Lc, Lp) / sp.outer + Math.max(0, Lp - Lc) / sp.inner;
    if (Ai < 1e-6) continue;
    // Núcleo "cubierto": dentro de la pieza en todas las capas vecinas.
    let cover = inner[i];
    let open = false;
    for (let j = i - topBottom; j <= i + topBottom && !open; j++) {
      if (j === i) continue;
      if (j < 0 || j >= n) { open = true; break; }
      cover = cover.intersect(cs[j]);
      if (cover.area() < 1e-6) open = true;
    }
    const As = open ? 0 : cover.area();
    sol += Ai - As;
    spa += As;
    sec += (Ai - As) / lw / sp.solid + (As * infill) / lw / sp.sparse;
  }
  const k = lh * density / 1000;                 // mm² × capa → g
  const r = { perimeter: per * k, solid: sol * k, sparse: spa * k * infill };
  r.g = r.perimeter + r.solid + r.sparse;
  r.min = sec / 60;                              // minutos (estimación relativa)
  return r;
}

/**
 * Ajustes de laminador por tipo de pieza. `eco`: perímetros = líneas de la
 * pared (todo perímetro), relleno bajo; normal: lo que recomienda el LEEME.
 */
export function sliceSettings(D, part, eco) {
  const lw = D.lw, lh = D.lh;
  const wallLines = Math.max(2, Math.round(D.t / lw));
  switch (part.id) {
    case 'base': case 'lid':
      return { lw, lh, perimeters: eco ? wallLines : Math.max(4, wallLines), topBottom: 5, infill: eco ? 0.08 : 0.2 };
    case 'insert': case 'insertLid':
      return { lw, lh, perimeters: 2, topBottom: 4, infill: 0 };
    case 'orgPanel':
      return { lw, lh, perimeters: 3, topBottom: 4, infill: eco ? 0.1 : 0.15 };
    case 'gasket':
      return { lw, lh, perimeters: 99, topBottom: 99, infill: 1, density: 1.21 };
    default:                                      // cierres, pasadores, tapones
      return { lw, lh, perimeters: 5, topBottom: 5, infill: 1 };
  }
}

/** Sólido de una pieza del resultado (malla sin normales) en su orientación de impresión. */
export function partSolid(p) {
  if (p.mesh.numProp !== 3) throw new Error('partSolid: construye con normals:false');
  const s = M().ofMesh({ numProp: 3, vertProperties: p.mesh.vert, triVerts: p.mesh.tri }).transform(p.print);
  const z = s.boundingBox().min[2];
  return s.translate([0, 0, -z]);
}
