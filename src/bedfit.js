/**
 * bedfit.js — Optimización del volumen de construcción.
 *
 * Para cada pieza (ya en su orientación de impresión):
 *   1. ¿Cabe tal cual en X×Y?                         → 0°
 *   2. ¿Cabe girada 90°?                              → 90°
 *   3. ¿Cabe girada un ángulo θ (diagonal)?           → θ mínimo que cabe
 *      Se usa la envolvente convexa 2D de la huella: la caja envolvente de un
 *      polígono girado es exacta y barata (decenas de vértices).
 *   4. Si no cabe plana: inclinación α alrededor de X + giro θ en Z.
 *      Se busca el α más pequeño (menos soportes) que haga caber la pieza en
 *      X×Y×Z. Se informa como sugerencia porque exige soportes.
 * Después se empaquetan todas las copias en placas por estantes (shelf
 * packing), empezando por las piezas grandes.
 */

/** Aplica una matriz 4×4 (columna mayor) a los vértices de una malla. */
export function transformVerts(vert, numProp, m) {
  const n = vert.length / numProp;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = vert[i * numProp], y = vert[i * numProp + 1], z = vert[i * numProp + 2];
    out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/** Envolvente convexa 2D (cadena monótona de Andrew). */
export function hull2D(xyz) {
  const pts = [];
  for (let i = 0; i < xyz.length; i += 3) pts.push([xyz[i], xyz[i + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Caja envolvente de un polígono girado θ grados. */
export function rotatedExtent(hull, deg) {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of hull) {
    const u = c * x - s * y, v = s * x + c * y;
    if (u < x0) x0 = u; if (u > x1) x1 = u;
    if (v < y0) y0 = v; if (v > y1) y1 = v;
  }
  return { w: x1 - x0, h: y1 - y0, x0, y0 };
}

/**
 * Mejor ángulo en Z para que la huella quepa en bx × by.
 * @returns {{ok:boolean, angle:number, mode:string, w:number, h:number}}
 */
export function fitAngle(hull, bx, by) {
  const e0 = rotatedExtent(hull, 0);
  if (e0.w <= bx && e0.h <= by) return { ok: true, angle: 0, mode: 'recta', ...e0 };
  const e90 = rotatedExtent(hull, 90);
  if (e90.w <= bx && e90.h <= by) return { ok: true, angle: 90, mode: 'girada 90°', ...e90 };
  // Búsqueda gruesa del ángulo más pequeño que cabe, y refinado.
  for (let a = 0.5; a < 180; a += 0.5) {
    const e = rotatedExtent(hull, a);
    if (e.w <= bx && e.h <= by) {
      let lo = a - 0.5, hi = a;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2, m = rotatedExtent(hull, mid);
        if (m.w <= bx && m.h <= by) hi = mid; else lo = mid;
      }
      // Pequeño margen de seguridad hacia dentro del rango válido.
      const ang = Math.min(hi + 0.2, a);
      return { ok: true, angle: round(ang, 2), mode: 'diagonal', ...rotatedExtent(hull, ang) };
    }
  }
  return { ok: false, angle: 0, mode: 'no cabe', ...e0 };
}

/**
 * Inclinación mínima + giro en Z para que la pieza quepa cuando no cabe plana.
 * Se prueban dos ejes de inclinación (X e Y de impresión) y se elige el menor
 * ángulo α: menos inclinación = menos soportes y mejor acabado.
 */
export function tiltSolve(xyz, bed) {
  // Submuestreo: suficiente para extensiones con < 0.1 mm de error.
  const step = Math.max(1, Math.floor(xyz.length / 3 / 6000));
  const pts = [];
  for (let i = 0; i < xyz.length; i += 3 * step) pts.push([xyz[i], xyz[i + 1], xyz[i + 2]]);
  for (let alpha = 5; alpha <= 90; alpha += 5) {
    const ca = Math.cos((alpha * Math.PI) / 180), sa = Math.sin((alpha * Math.PI) / 180);
    for (const axis of ['X', 'Y']) {
      const rot = new Float32Array(pts.length * 3);
      let z0 = Infinity, z1 = -Infinity;
      pts.forEach(([x, y, z], i) => {
        let x2 = x, y2 = y, z2;
        if (axis === 'X') { y2 = ca * y - sa * z; z2 = sa * y + ca * z; }
        else { x2 = ca * x + sa * z; z2 = -sa * x + ca * z; }
        rot[i * 3] = x2; rot[i * 3 + 1] = y2; rot[i * 3 + 2] = z2;
        if (z2 < z0) z0 = z2; if (z2 > z1) z1 = z2;
      });
      if (z1 - z0 > bed.z) continue;
      const f = fitAngle(hull2D(rot), bed.x, bed.y);
      if (f.ok) return { ok: true, alpha, axis, angle: f.angle };
    }
  }
  return { ok: false };
}

/**
 * Empaqueta las piezas en placas.
 * @param items [{key, label, hull, height, fit}] — `fit` de fitAngle
 * @returns placas: [{items:[{key,label,angle,x,y}], used}]
 */
export function packPlates(items, bed, gap = 6) {
  const sorted = [...items].sort((a, b) => b.fit.w * b.fit.h - a.fit.w * a.fit.h);
  const plates = [];
  const newPlate = () => { const p = { items: [], shelves: [], y: 0 }; plates.push(p); return p; };
  for (const it of sorted) {
    const { w, h } = it.fit;
    let placed = false;
    for (const p of plates) {
      // ¿Cabe en un estante existente?
      for (const s of p.shelves) {
        if (h <= s.h && s.x + w <= bed.x) {
          p.items.push({ ...it, x: s.x, y: s.y }); s.x += w + gap; placed = true; break;
        }
      }
      if (placed) break;
      // ¿Nuevo estante en esta placa?
      if (p.y + h <= bed.y && w <= bed.x) {
        const s = { y: p.y, h, x: w + gap };
        p.shelves.push(s); p.items.push({ ...it, x: 0, y: p.y }); p.y += h + gap; placed = true; break;
      }
    }
    if (!placed) {
      const p = newPlate();
      const s = { y: 0, h, x: w + gap };
      p.shelves.push(s); p.items.push({ ...it, x: 0, y: 0 }); p.y = h + gap;
    }
  }
  return plates.map((p) => ({ items: p.items }));
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Elige la inclinación para piezas que no caben planas, PRIORIZANDO 45°:
 * a 45° el fondo y las paredes de una caja quedan en el límite de voladizo
 * imprimible sin soporte. Se prueban ángulos por cercanía a 45° y los dos
 * ejes, empezando por el que acorta la dimensión más larga.
 */
export function tiltChoose(xyz, bed, prefer) {
  let ex = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < xyz.length; i += 3) {
    ex = [Math.min(ex[0], xyz[i]), Math.max(ex[1], xyz[i]), Math.min(ex[2], xyz[i + 1]), Math.max(ex[3], xyz[i + 1])];
  }
  const axes = prefer ? [prefer, prefer === 'Y' ? 'X' : 'Y'] : ex[1] - ex[0] >= ex[3] - ex[2] ? ['Y', 'X'] : ['X', 'Y'];
  const angles = [];
  for (let a = 5; a <= 85; a += 5) angles.push(a);
  angles.sort((p, q) => Math.abs(p - 45) - Math.abs(q - 45) || p - q);
  // Con eje preferido se agotan primero todos sus ángulos (simetría del bisel
  // en los extremos cortos) antes de probar el otro eje.
  const order = prefer ? axes.flatMap((ax) => angles.map((a) => [a, ax])) : angles.flatMap((a) => axes.map((ax) => [a, ax]));
  for (const [alpha, axis] of order) {
    const ca = Math.cos((alpha * Math.PI) / 180), sa = Math.sin((alpha * Math.PI) / 180);
    {
      const rot = new Float32Array(xyz.length);
      let z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < xyz.length; i += 3) {
        const x = xyz[i], y = xyz[i + 1], z = xyz[i + 2];
        let x2 = x, y2 = y, z2;
        if (axis === 'X') { y2 = ca * y - sa * z; z2 = sa * y + ca * z; } else { x2 = ca * x + sa * z; z2 = -sa * x + ca * z; }
        rot[i] = x2; rot[i + 1] = y2; rot[i + 2] = z2;
        if (z2 < z0) z0 = z2; if (z2 > z1) z1 = z2;
      }
      if (z1 - z0 > bed.z) continue;
      const f = fitAngle(hull2D(rot), bed.x, bed.y);
      if (f.ok) return { ok: true, alpha, axis, angle: f.angle };
    }
  }
  return { ok: false };
}
