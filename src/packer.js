/**
 * packer.js — Acomodo automático de varios objetos (calcos SVG) en un inserto.
 *
 * Objetivo: la caja más pequeña posible (menos material y menos espacio) sin
 * perder resistencia ni facilidad para sacar las piezas.
 *
 *  - Cada objeto ocupa su "huella": contorno + holgura + huecos para dedos
 *    + media pared de separación (la pared entre dos alojamientos nunca es
 *    más fina que `spacing`, así el inserto conserva su rigidez).
 *  - Orientaciones: el eje mayor del objeto alineado con la caja (rectángulo
 *    de área mínima) y sus giros de 90/180/270°. El giro de 180° permite
 *    encajes "cabeza con cola" (p. ej. llaves y herramientas con un extremo
 *    ancho), que es lo que da el acomodo orgánico.
 *  - Colocación por gravedad (estilo Tetris) sobre una rejilla de 1 mm:
 *    cada pieza cae hasta tocar lo ya colocado, en la columna y orientación
 *    que dejan el montón más bajo. Muy rápido: decenas de anchos y órdenes
 *    se prueban en milisegundos y se queda el de menor área.
 *  - Los huecos para dedos se calculan aquí (bordes del eje menor del objeto)
 *    y viajan al motor, así la huella usada para acomodar es exactamente la
 *    que se recorta en el inserto.
 */
import { hull2D } from './bedfit.js';

/* ---------------- Geometría 2D pura ---------------- */
const rot = (pts, a) => { const c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [c * x - s * y, s * x + c * y]); };
function bbox(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
function minAreaAngle(pts) {
  const flat = new Float32Array(pts.flatMap(([x, y]) => [x, y, 0]));
  const hull = hull2D(flat);
  let best = { area: Infinity, a: 0 };
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length];
    const a = -Math.atan2(by - ay, bx - ax);
    const b = bbox([rot(hull, a)]);
    if (b.w * b.h < best.area) best = { area: b.w * b.h, a: b.w >= b.h ? a : a + Math.PI / 2 };
  }
  return best.a;
}
function pointInPolys(polys, x, y) {
  let inside = false;
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function rayExit(polys, o, d) {
  let best = 0;
  for (const c of polys) for (let i = 0; i < c.length; i++) {
    const [ax, ay] = c[i], [bx, by] = c[(i + 1) % c.length];
    const ex = bx - ax, ey = by - ay, den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - o[0]) * ey - (ay - o[1]) * ex) / den;
    const s = ((ax - o[0]) * d[1] - (ay - o[1]) * d[0]) / den;
    if (t > 0 && s >= 0 && s <= 1 && t > best) best = t;
  }
  return best;
}

/**
 * Huecos para dedos de un objeto ya orientado (eje mayor en X): en los bordes
 * superior/inferior del objeto, en la posición `pos` (−1…1) del eje mayor.
 */
export function notchesFor(polys, opt) {
  const n = opt.fingerCount === 'auto' ? 2 : Number(opt.fingerCount);
  if (!n) return [];
  const b = bbox(polys);
  const cx = (b.x0 + b.x1) / 2 + ((opt.fingerPos || 0) / 100) * (b.w / 2);
  const cy = (b.y0 + b.y1) / 2;
  const out = [];
  for (const sg of n === 1 ? [1] : [1, -1]) {
    const t = rayExit(polys, [cx, cy], [0, sg]);
    out.push([cx, cy + sg * t]);
  }
  return out;
}

/* ---------------- Rasterizado ---------------- */
/**
 * Dos capas de ocupación (res mm/celda):
 *  - núcleo: contorno + holgura + media separación (nunca se solapa con nada);
 *  - huecos: círculos para dedos + media separación. Los huecos de dos objetos
 *    vecinos SÍ pueden solaparse (un solo hueco sirve a los dos), pero nunca
 *    invadir el núcleo de otro objeto.
 */
function raster(polys, notches, opt, res) {
  const growC = opt.pocketTol + opt.spacing / 2, growN = opt.spacing / 2;
  const r = opt.fingerD / 2;
  const b = bbox(polys);
  const pad = growC + (notches.length ? r + growN : 0) + res;
  const x0 = b.x0 - pad, y0 = b.y0 - pad;
  const W = Math.ceil((b.w + 2 * pad) / res), H = Math.ceil((b.h + 2 * pad) / res);
  const core = new Uint8Array(W * H), notch = new Uint8Array(W * H);
  const rc = r + growN;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + (i + 0.5) * res, y = y0 + (j + 0.5) * res;
    if (pointInPolys(polys, x, y)) core[j * W + i] = 1;
    for (const [nx, ny] of notches) if ((x - nx) ** 2 + (y - ny) ** 2 <= rc * rc) { notch[j * W + i] = 1; break; }
  }
  const dil = (src, g) => {
    const k = Math.ceil(g / res), out = new Uint8Array(W * H), disk = [];
    for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) if (di * di + dj * dj <= k * k + 0.5) disk.push([di, dj]);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (!src[j * W + i]) continue;
      for (const [di, dj] of disk) { const a = i + di, c = j + dj; if (a >= 0 && c >= 0 && a < W && c < H) out[c * W + a] = 1; }
    }
    return out;
  };
  const C = dil(core, growC);
  const prof = (g) => {
    const bot = new Int32Array(W).fill(-1), top = new Int32Array(W).fill(-1);
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) if (g[j * W + i]) { if (bot[i] < 0) bot[i] = j; top[i] = j; }
    return { bot, top };
  };
  const any = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) any[k] = C[k] | notch[k];
  return { W, H, x0, y0, core: prof(C), notch: prof(notch), any: prof(any) };
}

/* ---------------- Empaquetado ---------------- */

/**
 * @param objects [{ polys, qty }] polígonos en mm (cualquier orientación)
 * @param opt { spacing, pocketTol, fingerCount, fingerD, fingerPos, rotate,
 *              stripW (mm, opcional: ancho fijo), maxH (mm, opcional),
 *              fitsBed(w, h) → bool (opcional: ¿la caja resultante cabe plana?) }
 * @returns { placed: [{ polys, notches }], w, h, ms, tries } en mm, centrado,
 *          con el lado largo en X.
 */
export function pack(objects, opt) {
  const t0 = performance.now();
  const res = opt.res || 1;
  // Instancias × orientaciones (cada una con su huella rasterizada).
  const inst = [];
  objects.forEach((o, oi) => {
    const a0 = minAreaAngle(o.polys.flat());
    const angles = opt.rotate === false ? [a0] : [a0, a0 + Math.PI / 2, a0 + Math.PI, a0 + 1.5 * Math.PI];
    const orients = angles.map((a) => {
      const pr = o.polys.map((p) => rot(p, a));
      const b = bbox(pr);
      const cen = pr.map((p) => p.map(([x, y]) => [x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2]));
      // Los huecos se calculan con el objeto horizontal (eje mayor en X) y se
      // giran con él, para que siempre queden en los bordes del eje menor.
      const flatA = a0 + 0;
      const horiz = o.polys.map((p) => rot(p, flatA));
      const bh = bbox(horiz);
      const hc = horiz.map((p) => p.map(([x, y]) => [x - (bh.x0 + bh.x1) / 2, y - (bh.y0 + bh.y1) / 2]));
      const nh = notchesFor(hc, opt);
      const nr = rot(nh, a - flatA);
      return { polys: cen, notches: nr, ras: raster(cen, nr, opt, res) };
    });
    for (let q = 0; q < (o.qty || 1); q++) inst.push({ oi, orients, area: o.polys.reduce((s, p) => s + Math.abs(polyArea(p)), 0) });
  });
  if (!inst.length) return null;

  const orders = [
    [...inst].sort((a, b) => b.area - a.area),
    [...inst].sort((a, b) => Math.max(b.orients[0].ras.W, b.orients[0].ras.H) - Math.max(a.orients[0].ras.W, a.orients[0].ras.H)),
    [...inst].sort((a, b) => b.orients[0].ras.H - a.orients[0].ras.H),
  ];
  const minW = Math.max(...inst.map((it) => Math.min(...it.orients.map((o) => o.ras.W))));
  const sumW = inst.reduce((s, it) => s + Math.max(...it.orients.map((o) => o.ras.W)), 0);
  const widths = [];
  if (opt.stripW) widths.push(Math.floor(opt.stripW / res));
  else {
    const step = Math.max(1, Math.round((sumW - minW) / 40));
    for (let w = minW; w <= Math.max(minW, sumW); w += step) widths.push(w);
  }

  let best = null, tries = 0;
  for (const order of orders) for (const SW of widths) {
    tries++;
    // Perfiles del montón: primera celda libre por columna para el núcleo y
    // para "cualquier cosa" (núcleo o hueco).
    const topCore = new Int32Array(SW).fill(0), topAny = new Int32Array(SW).fill(0);
    const placed = [];
    let ok = true;
    for (const it of order) {
      let cand = null;
      for (let oi = 0; oi < it.orients.length; oi++) {
        const R = it.orients[oi].ras;
        if (R.W > SW) continue;
        for (let x = 0; x + R.W <= SW; x++) {
          let y = 0;
          for (let c = 0; c < R.W; c++) {
            // Núcleo nuevo sobre todo lo colocado; hueco nuevo solo sobre núcleos.
            if (R.core.bot[c] >= 0) y = Math.max(y, topAny[x + c] - R.core.bot[c]);
            if (R.notch.bot[c] >= 0) y = Math.max(y, topCore[x + c] - R.notch.bot[c]);
          }
          const h = y + R.H;
          if (!cand || h < cand.h || (h === cand.h && (y < cand.y || (y === cand.y && x < cand.x)))) cand = { x, y, h, oi };
        }
      }
      if (!cand) { ok = false; break; }
      const R = it.orients[cand.oi].ras;
      for (let c = 0; c < R.W; c++) {
        if (R.core.top[c] >= 0) topCore[cand.x + c] = Math.max(topCore[cand.x + c], cand.y + R.core.top[c] + 1);
        if (R.any.top[c] >= 0) topAny[cand.x + c] = Math.max(topAny[cand.x + c], cand.y + R.any.top[c] + 1);
      }
      placed.push({ it, ...cand });
    }
    const top = topAny;
    if (!ok) continue;
    const H = Math.max(...top);
    let used = 0;
    for (let i = 0; i < SW; i++) if (top[i] > 0) used = i + 1;
    if (opt.maxH && H * res > opt.maxH) continue;
    // Área del rectángulo + leve preferencia por proporciones de caja (≤ 3:1).
    const wmm = used * res, hmm = H * res;
    const asp = Math.max(wmm, hmm) / Math.max(1, Math.min(wmm, hmm));
    let score = wmm * hmm * (asp > 3 ? 1 + 0.05 * (asp - 3) : 1);
    // Preferir disposiciones con las que la caja cabe PLANA en la cama
    // (imprimir inclinada cuesta tiempo, soportes y acabado).
    if (opt.fitsBed && !opt.fitsBed(wmm, hmm)) score *= 4;
    if (!best || score < best.score) best = { score, placed, SW, H, used };
  }
  if (!best) return null;

  // A milímetros: polígonos y huecos en su posición; centrado del conjunto.
  const out = best.placed.map(({ it, x, y, oi }) => {
    const o = it.orients[oi], R = o.ras;
    const dx = x * res - R.x0, dy = y * res - R.y0;
    return {
      obj: it.oi,
      polys: o.polys.map((p) => p.map(([px, py]) => [px + dx, py + dy])),
      notches: o.notches.map(([nx, ny]) => [nx + dx, ny + dy]),
    };
  });
  const r = opt.fingerD / 2;
  const geo = (q) => [...q.polys, ...q.notches.map(([nx, ny]) => Array.from({ length: 16 }, (_, k) => [nx + r * Math.cos((k / 16) * 2 * Math.PI), ny + r * Math.sin((k / 16) * 2 * Math.PI)]))];
  const b = bbox(out.flatMap(geo));
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  let placed = out.map((q) => ({ ...q, polys: q.polys.map((p) => p.map(([x, y]) => [x - cx, y - cy])), notches: q.notches.map(([x, y]) => [x - cx, y - cy]) }));
  let w = b.w, h = b.h;
  if (h > w) {   // lado largo en X
    placed = placed.map((q) => ({ ...q, polys: q.polys.map((p) => p.map(([x, y]) => [-y, x])), notches: q.notches.map(([x, y]) => [-y, x]) }));
    [w, h] = [h, w];
  }
  return { placed, w, h, ms: Math.round(performance.now() - t0), tries, footprint: placed.flatMap(geo) };
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; }
  return a / 2;
}
