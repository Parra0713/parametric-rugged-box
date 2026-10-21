/**
 * tilt.js — Impresión inclinada cuando la pieza no cabe plana en la cama.
 *
 * Estrategia (tres frentes, optimizando material, tiempo y fiabilidad):
 *
 * 1. ÁNGULO: se prefiere 45°. Una caja abierta inclinada 45° sobre un eje
 *    horizontal deja fondo y paredes a 45°, el límite de voladizo que FDM
 *    imprime sin soporte. Si 45° no cabe en X×Y×Z se elige el ángulo factible
 *    más cercano a 45°, con el eje que acorta la dimensión que no cabía.
 *
 * 2. CORTE DIAGONAL DE CONTACTO: inclinada, la caja apoyaría en una arista
 *    (contacto lineal → se despega en las primeras capas). Se recorta esa
 *    arista con un plano paralelo a la cama hasta lograr una franja plana de
 *    apoyo de ≥ 8–15 mm, sin llegar a la cavidad: se conserva al menos un
 *    espesor de pared bajo el corte. El chaflán resultante forma parte del
 *    diseño (arista biselada, típica de maletines rugerizados).
 *
 * 3. ALETAS DE SOPORTE (en vez de cuña maciza o árboles):
 *    - Láminas verticales de 2 líneas en planos perpendiculares al eje de
 *      inclinación: siguen exactamente la cara inferior de la pieza.
 *    - Separación de una holgura con la pieza; solo unos "dientes" de una
 *      línea, cada 6 mm, tocan la pieza (se rompen limpio).
 *    - Aletas en ambos extremos (soporte perimetral) y repartidas por el
 *      interior cada ~25 mm: las caras a ≤ 45° se sostienen solas, las aletas
 *      dan estabilidad lateral (la pieza inclinada tiende a volcar).
 *    - Pie ensanchado de 2 capas en la base de cada aleta (adherencia).
 *    Resultado típico: 5–15 % del material de una cuña de soporte.
 */
import { CS, M, prism } from './geo.js';

/* ---------- Matrices ---------- */
export function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
/** Inversa de una matriz rígida (rotación + traslación). */
export function invRigid(m) {
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}
export const Tm = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export function rotAxis(axis, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return axis === 'X'
    ? [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
    : [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/* ---------- 2. Corte diagonal de contacto ---------- */

/**
 * Área de los agujeros "grandes" de una sección: un agujero tan largo como la
 * pieza indica que el corte ya alcanzó la cavidad. Los huecos pequeños
 * (celdas del grabado, ranuras de sombra, taladros) no cuentan.
 */
function bigHoleArea(cs, minArea) {
  if (cs.isEmpty()) return 0;
  let a = 0;
  for (const c of cs.toPolygons()) {
    let s = 0;
    for (let i = 0; i < c.length; i++) { const [x0, y0] = c[i], [x1, y1] = c[(i + 1) % c.length]; s += x0 * y1 - x1 * y0; }
    s /= 2;
    if (s < -minArea) a += -s;
  }
  return a;
}

/**
 * Recorta la arista inferior de la pieza inclinada `R` (z ≥ zmin).
 * @param axisLen longitud de la pieza a lo largo del eje de inclinación
 * @returns {h, width} altura del corte sobre zmin y ancho de la franja
 */
export function contactCut(R, zmin, axisLen, t, lh) {
  const target = Math.min(15, Math.max(6, 0.06 * axisLen));
  const width = (h) => R.slice(zmin + h).area() / axisLen;
  // Altura a la que el corte alcanzaría la cavidad (aparece un agujero).
  const minA = 2 * axisLen;
  let hBreach = 30;
  for (let h = 0.4; h < 30; h += 0.4) { if (bigHoleArea(R.slice(zmin + h), minA) > 0) { hBreach = h; break; } }
  const hMax = Math.max(0, hBreach - t * 1.2);               // deja ≥ 1 pared bajo el corte
  let lo = 0, hi = hMax;
  if (width(hi) < target) lo = hi;                           // no llega: corta lo máximo seguro
  for (let k = 0; k < 18 && hi - lo > 0.05; k++) {
    const mid = (lo + hi) / 2;
    if (width(mid) >= target) hi = mid; else lo = mid;
  }
  let h = Math.round(Math.min(hi, hMax) / lh) * lh;           // en capas enteras
  if (h < lh) h = 0;
  return { h, width: h > 0 ? Math.round(width(h) * 10) / 10 : 0, target };
}

/* ---------- 3. Aletas de soporte ---------- */

/**
 * Región bajo la envolvente inferior de una sección 2D P (u horizontal,
 * v vertical): columnas bajo cualquier arista menos el barrido hacia arriba.
 */
function shadowBelow(P) {
  const b = P.bounds();
  const big = b.max[1] + 100;
  const up = [], down = [];
  for (const poly0 of P.toPolygons()) {
    for (let i = 0; i < poly0.length; i++) {
      const [x0, y0] = poly0[i], [x1, y1] = poly0[(i + 1) % poly0.length];
      if (Math.abs(x1 - x0) < 1e-6) continue;
      const [a, c] = x0 < x1 ? [[x0, y0], [x1, y1]] : [[x1, y1], [x0, y0]];
      up.push([a, c, [c[0], big], [a[0], big]]);              // barrido hacia arriba
      down.push([[a[0], 0], [c[0], 0], c, a]);                // columna hasta la cama
    }
  }
  // Solo columnas que tienen pieza encima, y por debajo de su punto más bajo.
  const below = CS().ofPolygons(down, 'Positive');
  return below.subtract(CS().ofPolygons(up, 'Positive').add(P));
}

/**
 * Aletas bajo la pieza inclinada R (ya apoyada en z = 0).
 * @param axis eje de inclinación ('X' o 'Y'): las aletas son perpendiculares
 */
export function supportFins(R, axis, lw, lh, opt = {}) {
  const bb = R.boundingBox();
  const ax = axis === 'X' ? 0 : 1;
  const a0 = bb.min[ax], a1 = bb.max[ax];
  const len = a1 - a0;
  const spacing = opt.spacing > 0 ? opt.spacing : 40;
  const n = Math.max(3, Math.ceil(len / spacing) + 1);
  const thick = 2 * lw;                 // 2 líneas
  const gap = opt.gap > 0 ? opt.gap : Math.max(0.25, lh * 1.5); // holgura con la pieza
  const pitch = opt.pitch > 0 ? opt.pitch : 6;
  const reachF = opt.reach > 0 ? opt.reach / 100 : null;   // null = hasta el centro de masa
  // Transformación que lleva el plano de la aleta a "horizontal" para cortar:
  //  eje X → planos x = cte → (x,y,z)→(y,z,x) ; eje Y → (x,y,z)→(x,z,−y).
  const toSlice = axis === 'X'
    ? [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]
    : [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
  const back = invRigid(toSlice);
  const Rs = R.transform(toSlice);
  const fins = [];
  let vol = 0;
  for (let i = 0; i < n; i++) {
    const pos = a0 + 3 + ((len - 6) * i) / (n - 1);
    const h = axis === 'X' ? pos : -pos;
    const P = Rs.slice(h);
    if (P.isEmpty()) continue;
    const sh = shadowBelow(P);
    const keep = sh.subtract(P.offset(gap, 'Round', 2, 16));
    // Estabilidad sin desperdicio: basta con que las aletas lleguen un poco
    // más allá de la vertical del centro de masa (las caras a ≤ 45° se
    // sostienen solas). El material de una aleta crece con el cuadrado de su
    // altura, así que recortarla aquí ahorra ~60 %.
    const pb0 = P.bounds();
    const w = pb0.max[0] - pb0.min[0], uc = (pb0.min[0] + pb0.max[0]) / 2;
    let vmin = Infinity, ulow = uc;
    for (const c of P.toPolygons()) for (const [u, v] of c) if (v < vmin) { vmin = v; ulow = u; }
    // Límite: centro de masa + 15 % del ancho, o el % fijado por el usuario
    // medido desde la arista de apoyo.
    const lim = reachF != null
      ? (ulow <= uc ? pb0.min[0] + reachF * w : pb0.max[0] - reachF * w)
      : (ulow <= uc ? uc + 0.15 * w : uc - 0.15 * w);
    const reach = ulow <= uc
      ? CS().square([lim - (pb0.min[0] - 5), pb0.max[1] + 10], false).translate([pb0.min[0] - 5, -1])
      : CS().square([pb0.max[0] + 5 - lim, pb0.max[1] + 10], false).translate([lim, -1]);
    // Restos de menos de 1 mm de ancho no sirven como aleta.
    let fin = keep.intersect(reach).offset(-0.5, 'Square').offset(0.5, 'Square');
    if (fin.isEmpty()) continue;
    // Aligerado en celosía (diagonales a 45°: se imprimen sin puentes):
    // se conserva un marco de 2.5 mm y el borde superior completo.
    const inner = fin.offset(-2.5, 'Square');
    if (!inner.isEmpty()) {
      const ib = inner.bounds(), cells = [];
      const pitch = 12, side = 8;
      for (let u = ib.min[0] - pitch; u <= ib.max[0] + pitch; u += pitch)
        for (let v = ib.min[1] - pitch; v <= ib.max[1] + pitch; v += pitch)
          cells.push(CS().square([side, side], true).rotate(45).translate([u, v]));
      const holesCs = CS().union(cells).intersect(inner);
      const big = holesCs.decompose().filter((c) => c.area() > 12);
      if (big.length) fin = fin.subtract(CS().union(big));
    }
    // Dientes de contacto: tiras de 1 línea cada 6 mm que cruzan la holgura.
    const pb = P.bounds();
    const bars = [];
    for (let u = Math.ceil(pb.min[0] / pitch) * pitch; u <= pb.max[0]; u += pitch) bars.push(CS().square([lw, pb.max[1] + 5], false).translate([u - lw / 2, 0]));
    if (bars.length) {
      // Franja de la holgura (con 0.05 mm de solape con la pieza) solo junto a
      // la envolvente inferior.
      const band = P.offset(gap + 0.05, 'Round', 2, 16).subtract(P.offset(-0.05, 'Round', 2, 16));
      // Solo junto a la parte útil de la aleta (no dientes sueltos).
      fin = fin.add(band.intersect(CS().union(bars)).intersect(fin.offset(gap + 0.6, 'Square')));
    }
    // Pie: dos capas, 6 mm de ancho total, bajo la aleta.
    const foot = fin.intersect(CS().square([pb.max[0] - pb.min[0] + 20, 2 * lh], false).translate([pb.min[0] - 10, 0]));
    const finSolid = prism(fin, h - thick / 2, h + thick / 2);
    const footSolid = prism(foot.offset(1.5, 'Square').intersect(CS().square([1e4, 2 * lh], false).translate([-5e3, 0])), h - 3, h + 3);
    const s = finSolid.add(footSolid);
    vol += s.volume();
    fins.push(s.transform(back));
  }
  if (!fins.length) return null;
  return { solid: M().union(fins), volume: Math.round(vol), count: fins.length };
}

/** Volumen de una cuña maciza equivalente (para comparar el ahorro). */
export function wedgeVolume(R, lh) {
  const bb = R.boundingBox();
  let v = 0;
  // Volumen bajo la envolvente inferior ≈ Σ capas del área de la sombra.
  const step = Math.max(lh * 5, (bb.max[2] - bb.min[2]) / 60);
  for (let z = step / 2; z < bb.max[2]; z += step) {
    const s = R.slice(z);
    if (s.isEmpty()) continue;
    v += s.hull().area() * step;
  }
  return Math.round(Math.max(0, v - R.volume()));
}


/* ---------- 4. Voladizos de partes salientes (bisagras, cierres) ---------- */

/**
 * Detector de voladizos por capas.
 *
 * Una capa k está soportada si cada punto queda a ≤ step·tan(θ) de la capa
 * anterior (θ = ángulo máximo de voladizo, 50° por defecto: imprimible sin
 * soporte en PLA/PETG con buena ventilación). Lo que no cumple es un voladizo
 * o una "isla" que empezaría en el aire (típico del primer borde de un nudillo
 * o de una mejilla de cierre cuando la caja se inclina 45°).
 * @param R       sólido en orientación de impresión (z ≥ 0)
 * @param helper  sólido que ya da soporte (aletas), o null
 * @returns [{ z, region: CrossSection, area }]
 */
export function overhangRegions(R, helper, opt = {}) {
  const step = opt.step || 0.6;
  const tanT = Math.tan(((opt.angle || 50) * Math.PI) / 180);
  const minA = opt.minArea || 1.0;
  const bb = R.boundingBox();
  const all = helper ? R.add(helper) : R;
  const out = [];
  let prev = all.slice(Math.min(0.1, step / 2));
  for (let z = step; z < bb.max[2] - 0.05; z += step) {
    const cur = R.slice(z);
    if (!cur.isEmpty()) {
      let U = cur.subtract(prev.offset(step * tanT, 'Round', 2, 12));
      // Quita astillas de menos de ~0.6 mm de ancho (ruido de teselado).
      U = U.offset(-0.3, 'Square').offset(0.3, 'Square');
      for (const piece of U.decompose()) {
        const a = piece.area();
        if (a >= minA) out.push({ z, region: piece, area: a });
      }
    }
    prev = all.slice(z);
  }
  return out;
}

/**
 * Soportes locales para los voladizos detectados.
 *
 * Estrategia (equivale a los soportes "de rejilla con interfaz" de un slicer,
 * pero generados en el modelo, solo donde hacen falta):
 *  - Columna vertical bajo cada voladizo, hasta la cama o hasta la superficie
 *    de la pieza que haya debajo (separación de 1 capa en Z y 0.4 mm en XY).
 *  - Interior en rejilla de paredes de 2 líneas cada `pitch` mm (ligera y
 *    rígida), con una interfaz maciza de 2 capas arriba (superficie plana para
 *    que el voladizo apoye) y un pie macizo de 2 capas abajo (adherencia).
 *  - La separación de 1 capa con la pieza hace que se desprendan a mano.
 */
export function overhangSupports(R, regions, lw, lh, opt = {}) {
  if (!regions.length) return null;
  const gapZ = opt.gapZ ?? lh;
  const gapXY = opt.gapXY ?? 0.4;
  const pitch = opt.pitch || 3;
  const cols = [];
  for (const { z, region } of regions) {
    const top = z - gapZ;
    // Incluso un voladizo a 0.4 mm de la cama necesita algo debajo: 1–2
    // capas de soporte actúan como una mini‑balsa local.
    if (top < lh * 0.99) continue;
    cols.push(prism(region.offset(0.3, 'Square'), 0, top));
  }
  if (!cols.length) return null;
  let S = M().union(cols);
  // Holgura con la pieza: solo el trozo de pieza que rodea las columnas
  // (las columnas engordadas 1 mm), así las uniones son pequeñas y rápidas.
  const near = R.intersect(M().union(regions.filter((r) => r.z - gapZ >= lh * 0.99)
    .map((r) => prism(r.region.offset(1.5, 'Square'), -1, r.z + 2))));
  if (!near.isEmpty()) {
    const clear = M().union([
      near, near.translate([0, 0, gapZ]),
      near.translate([gapXY, 0, 0]), near.translate([-gapXY, 0, 0]),
      near.translate([0, gapXY, 0]), near.translate([0, -gapXY, 0]),
    ]);
    S = S.subtract(clear);
  }
  if (S.isEmpty()) return null;
  // Descarta restos sueltos minúsculos.
  const parts = S.decompose().filter((p) => p.volume() > 2);
  if (!parts.length) return null;
  S = M().union(parts);
  const b = S.boundingBox();
  // Rejilla de paredes de 2 líneas.
  const t = 2 * lw;
  const strips = [];
  for (let x = Math.floor(b.min[0] / pitch) * pitch; x <= b.max[0]; x += pitch)
    strips.push(CS().square([t, b.max[1] - b.min[1] + 2], false).translate([x - t / 2, b.min[1] - 1]));
  for (let y = Math.floor(b.min[1] / pitch) * pitch; y <= b.max[1]; y += pitch)
    strips.push(CS().square([b.max[0] - b.min[0] + 2, t], false).translate([b.min[0] - 1, y - t / 2]));
  const grid = prism(CS().union(strips), -1, b.max[2] + 1);
  const topSkin = S.subtract(S.translate([0, 0, -2 * lh]));          // 2 capas superiores
  const foot = S.intersect(M().cube([b.max[0] - b.min[0] + 2, b.max[1] - b.min[1] + 2, 2 * lh]).translate([b.min[0] - 1, b.min[1] - 1, 0]));
  const solid = M().union([S.intersect(grid), topSkin, foot]);
  return { solid, volume: Math.round(solid.volume()), count: parts.length, fullVolume: Math.round(S.volume()) };
}
