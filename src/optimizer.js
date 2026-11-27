/**
 * optimizer.js — ¿Se puede imprimir PLANA en vez de inclinada?
 *
 * Imprimir plano siempre gana (sin soportes, sin bisel, mejor acabado y
 * menos tiempo). Cuando la caja no cabe plana, se buscan los cambios de
 * menor impacto que la hagan caber (girada en Z si hace falta):
 *
 *   1. Recortar esquinas a 45° (octógono alargado). Con el contorno del
 *      contenido cargado se sabe cuánto se puede recortar sin tocarlo: el
 *      coste es casi nulo. Sin contorno, el coste es el área interior perdida.
 *   2. Quitar los nervios de esquina.
 *   3. Reducir el vuelo de la banda (mínimo 2 mm: la junta sigue cabiendo).
 *   4. Reducir la pared a un número menor de líneas, nunca por debajo de 4
 *      líneas ni de 1.6 mm (integridad estructural y estanqueidad).
 *
 * Todo se evalúa con la huella 2D exacta derivada de `derive()` (contorno
 * redondeado + bisagras + carcasas de cierre), sin construir geometría: cientos
 * de combinaciones en unos milisegundos.
 */
import { derive, octagonPts } from './engine/params.js';
import { hull2D, fitAngle } from './bedfit.js';
import { M as Msg } from './i18n/msg.js';

/** Desplaza hacia dentro un polígono convexo antihorario `d` mm. */
function insetConvex(pts, d) {
  const n = pts.length, lines = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    const l = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / l, ny = (x1 - x0) / l;
    lines.push([x0 + nx * d, y0 + ny * d, x1 - x0, y1 - y0]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay, adx, ady] = lines[(i + n - 1) % n], [bx, by, bdx, bdy] = lines[i];
    const den = adx * bdy - ady * bdx;
    if (Math.abs(den) < 1e-9) { out.push([bx, by]); continue; }
    const t = ((bx - ax) * bdy - (by - ay) * bdx) / den;
    out.push([ax + adx * t, ay + ady * t]);
  }
  return out;
}

/** Huella en planta (marco interno) de la base/tapa con su mecánica. */
export function footprint(D) {
  const pts = [];
  const sharp = D.cham > 0 ? octagonPts(D.Li, D.Wi, D.cham) : D.innerOutline;
  const core = insetConvex(sharp, D.ri);
  const R = D.ri + D.F;
  for (const [x, y] of core) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 2 * Math.PI;
    pts.push([x + R * Math.cos(a), y + R * Math.sin(a)]);
  }
  for (const xc of D.hinge.xs) {
    const y = D.ya + 1.2 * D.rk;
    pts.push([xc - D.hinge.len / 2 - 3, y], [xc + D.hinge.len / 2 + 3, y]);
  }
  for (const xc of D.latch.xs) {
    const y = -(D.sh + 1.3);
    pts.push([xc - D.latch.span / 2 - 3, y], [xc + D.latch.span / 2 + 3, y]);
  }
  return pts;
}

export function fitsFlat(D, bed) {
  const flat = new Float32Array(footprint(D).flatMap(([x, y]) => [x, y, 0]));
  return fitAngle(hull2D(flat), bed.x - 4, bed.y - 4);
}

/**
 * @param P         parámetros actuales
 * @param cmax      recorte máximo permitido por el contenido (null = sin contenido)
 * @returns {status:'fits'|'option'|'none', fit, best:{changes, P, fit, cost}, alts}
 */
export function optimize(P, cmax) {
  const bed = { x: P.bedX, y: P.bedY };
  const D0 = derive(P);
  const f0 = fitsFlat(D0, bed);
  if (f0.ok) return { status: 'fits', fit: f0 };

  const lw = P.lineWidth;
  const walls = [P.wall];
  for (let w = Math.round(P.wall / lw) - 1; w >= 4 && w * lw >= 1.6; w--) walls.push(+(w * lw).toFixed(2));
  const bands = [P.bandProud, 2.4, 2.0].filter((b, i, a) => a.indexOf(b) === i && (b === 0 || b <= (P.bandProud || D0.bo)));
  const limitC = Math.min(D0.Li, D0.Wi) / 2 - D0.ri - 1;
  const cTop = Math.max(0, Math.min(limitC, cmax ?? limitC * 0.6));
  const cuts = [P.cornerCut || 0];
  for (let c = Math.ceil((P.cornerCut || 0) + 1); c <= cTop; c += 1) cuts.push(c);
  const ribs = P.cornerRibs ? [true, false] : [false];

  const options = [];
  for (const c of cuts) for (const rb of ribs) for (const b of bands) for (const w of walls) {
    const Q = { ...P, cornerCut: c, cornerRibs: rb, bandProud: b, wall: w };
    const D = derive(Q);
    const f = fitsFlat(D, bed);
    if (!f.ok) continue;
    // Coste: impacto en el diseño (menor = mejor).
    const dc = c - (P.cornerCut || 0);
    let cost = 0;
    if (dc > 0) cost += cmax != null ? 0.2 + 0.02 * dc : 3 + dc * dc * (4 / (D.Li * D.Wi)) * 100;
    if (P.cornerRibs && !rb) cost += 0.6;
    if (b !== P.bandProud) cost += 1.0 * ((P.bandProud || D0.bo) - (b || D0.bo)) + 0.3;
    if (w !== P.wall) cost += 3 * (P.wall - w) + 0.5;
    const changes = [];
    if (dc > 0) changes.push(Msg('opt.corners', { mm: c, free: cmax != null, area: Math.round(2 * c * c) }));
    if (P.cornerRibs && !rb && c === 0) changes.push(Msg('opt.noRibs'));
    if (b !== P.bandProud) changes.push(Msg('opt.band', { mm: b }));
    if (w !== P.wall) changes.push(Msg('opt.wall', { mm: w, lines: Math.round(w / lw) }));
    options.push({ cost, changes, P: Q, fit: f });
  }
  if (!options.length) return { status: 'none', fit: f0 };
  options.sort((a, b) => a.cost - b.cost);
  // Alternativas distintas entre sí (por tipo de cambio).
  const seen = new Set(), alts = [];
  for (const o of options) {
    const key = o.changes.map((c) => c.k).join('+');
    if (!seen.has(key)) { seen.add(key); alts.push(o); }
    if (alts.length >= 3) break;
  }
  return { status: 'option', fit: f0, best: alts[0], alts };
}
