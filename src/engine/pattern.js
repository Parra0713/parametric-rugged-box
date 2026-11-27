/**
 * pattern.js — Patrones artísticos de la tapa y logo SVG.
 *
 * La tapa se imprime BOCA ABAJO: la cara decorada queda contra la cama y sale
 * con el acabado de la placa (PEI texturizado, liso, etc.).
 *
 *  - Grabado (engrave, recomendado): las celdas son cavidades. Su "techo" se
 *    imprime como puente.
 *  - Relieve (emboss): los nervios sobresalen. Se añade SIEMPRE un marco
 *    perimetral para que la tapa apoye plana; la superficie entre nervios se
 *    imprime como puente.
 *  En ambos casos `limitBridges` garantiza que ningún puente supere
 *  D.maxBridge (10 mm: a partir de ahí Orca/Bambu Studio ponen soporte).
 *
 * Todo se trabaja en 2D (CrossSection) y se extruye una única vez: es la
 * forma más barata de generar cientos de celdas.
 */
import { CS, poly, prism, frustum, unionAll } from './geo.js';
import { rrOffset, stackLines } from './seal.js';
import { M as Msg } from '../i18n/msg.js';

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

/** ¿Cabe un círculo de diámetro w dentro de la sección? */
const widerThan = (cs, w) => !cs.offset(-w / 2, 'Round', 2, 12).isEmpty();

/**
 * Limitador de puentes. La tapa se imprime boca abajo: toda cavidad de su cara
 * superior es un techo en el aire. Las celdas más anchas que `maxW` reciben
 * nervios finos paralelos a su eje mayor, con paso ≤ 0.8·maxW, de modo que
 * ningún puente supere el límite a partir del cual el laminador pone soporte.
 */
export function limitBridges(cs, maxW, rib) {
  if (!cs) return { cs, split: 0 };
  let split = 0;
  const out = [];
  for (const piece of cs.decompose()) {
    if (!widerThan(piece, maxW)) { out.push(piece); continue; }
    // Eje mayor (PCA de los vértices).
    const pts = piece.toPolygons().flat();
    let mx = 0, my = 0;
    for (const [x, y] of pts) { mx += x; my += y; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    const ang = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
    const loc = piece.translate([-mx, -my]).rotate(-ang);
    const b = loc.bounds();
    const W = b.max[1] - b.min[1], Lx = b.max[0] - b.min[0] + 2;
    const n = Math.max(1, Math.ceil(W / (0.8 * maxW + rib)) - 1);
    const bars = [];
    for (let i = 1; i <= n; i++) {
      const y = b.min[1] + (W * i) / (n + 1);
      bars.push(CS().square([Lx, rib], true).translate([(b.min[0] + b.max[0]) / 2, y]));
    }
    out.push(loc.subtract(CS().union(bars)).rotate(ang).translate([mx, my]));
    split++;
  }
  return { cs: out.length ? CS().compose(out.flatMap((o) => o.decompose())) : null, split };
}

/** Elimina astillas: islas con área menor a `minArea`. */
function filterSmall(cs, minArea) {
  const parts = cs.decompose().filter((p) => p.area() >= minArea);
  return parts.length ? CS().compose(parts) : null;
}

/** Convierte polilíneas con grosor en una sección 2D (segmentos + uniones). */
export function strokesSection(strokes) {
  const parts = [];
  for (const st of strokes) {
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
  return parts.length ? CS().union(parts) : null;
}

/** Generador pseudoaleatorio determinista (mulberry32): mismo dibujo con la misma semilla. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sci‑fi "circuito": pistas ortogonales y a 45° sobre una rejilla de paso p,
 * que salen de los bordes y terminan en pads (como una PCB). Las pistas no se
 * cruzan: cada nodo de la rejilla solo se ocupa una vez.
 */
function circuitCells(D, P, area) {
  const b = area.bounds();
  const p = Math.max(P.patternSize / 2, P.patternRib * 2.5);
  const nx = Math.floor((b.max[0] - b.min[0]) / p) - 1;
  const ny = Math.floor((b.max[1] - b.min[1]) / p) - 1;
  if (nx < 2 || ny < 2) return null;
  const x0 = (b.min[0] + b.max[0]) / 2 - ((nx - 1) * p) / 2;
  const y0 = (b.min[1] + b.max[1]) / 2 - ((ny - 1) * p) / 2;
  const used = new Set();
  const key = (i, j) => i * 10007 + j;
  const rand = rng(P.patternSeed | 0);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const strokes = [], pads = [];
  const nTraces = Math.round((nx * ny) / 6);
  for (let k = 0; k < nTraces; k++) {
    let i = Math.floor(rand() * nx), j = Math.floor(rand() * ny);
    if (used.has(key(i, j))) continue;
    used.add(key(i, j));
    const pts = [[x0 + i * p, y0 + j * p]];
    let d = dirs[Math.floor(rand() * 4)];
    const len = 3 + Math.floor(rand() * 8);
    for (let s = 0; s < len; s++) {
      if (rand() < 0.35) {          // giro a 45° (estética PCB)
        const opts = dirs.filter((q) => q[0] * d[0] + q[1] * d[1] > 0 && (q[0] !== d[0] || q[1] !== d[1]));
        d = opts[Math.floor(rand() * opts.length)];
      }
      const ni = i + d[0], nj = j + d[1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || used.has(key(ni, nj))) break;
      // Evita cruces en diagonal.
      if (d[0] && d[1] && used.has(key(i + d[0], j)) && used.has(key(i, j + d[1]))) break;
      i = ni; j = nj; used.add(key(i, j));
      pts.push([x0 + i * p, y0 + j * p]);
    }
    if (pts.length < 2) continue;
    strokes.push({ points: pts, width: P.patternRib });
    pads.push(CS().circle(P.patternRib * 1.3, 16).translate(pts[0]));
    const end = pts[pts.length - 1];
    pads.push(rand() < 0.5
      ? CS().circle(P.patternRib * 1.3, 16).translate(end)
      : CS().square([P.patternRib * 2.6, P.patternRib * 2.6], true).translate(end));
  }
  const tr = strokesSection(strokes);
  if (!tr) return null;
  return CS().union([tr, ...pads]).intersect(area.offset(-P.patternRib, 'Round', 2, 24));
}

/**
 * Sci‑fi "radial": anillos concéntricos segmentados y radios, como un
 * blasón/HUD. Los segmentos se alternan para que ninguna isla quede suelta.
 */
function radialCells(D, P, area) {
  const b = area.bounds();
  const R = Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 - P.patternRib;
  const p = Math.max(P.patternSize * 0.6, P.patternRib * 3);
  const rib = P.patternRib;
  const parts = [CS().circle(Math.max(rib * 1.5, p * 0.35), 48)];
  const rand = rng(P.patternSeed | 0);
  for (let r = p; r < R; r += p) {
    const ring = CS().circle(r + rib / 2, 96).subtract(CS().circle(r - rib / 2, 96));
    const n = 4 + 2 * Math.floor(r / p);
    const sectors = [];
    for (let k = 0; k < n; k++) {
      if ((k + Math.floor(r / p)) % 3 === 0) continue;       // huecos alternados
      const a0 = (k / n) * 360, a1 = ((k + 0.82) / n) * 360;
      const pts = [[0, 0]];
      for (let a = a0; a <= a1; a += 4) pts.push([Math.cos(a * Math.PI / 180) * (R + p), Math.sin(a * Math.PI / 180) * (R + p)]);
      sectors.push(poly(pts));
    }
    if (sectors.length) parts.push(ring.intersect(CS().union(sectors)));
  }
  const nSp = 8;
  const off = rand() * 22.5;
  for (let k = 0; k < nSp; k++) {
    const a = off + (k * 360) / nSp;
    parts.push(CS().square([R * 2.2, rib], false).translate([0, -rib / 2]).rotate(a));
  }
  return CS().union(parts).intersect(area.offset(-rib, 'Round', 2, 24));
}

/**
 * Construye el logo a partir de los datos preprocesados en el hilo principal
 * (svg.js): rellenos como polígonos con agujeros y trazos como polilíneas con
 * grosor, ya en mm y en el marco interno.
 */
export function logoSection(svg) {
  if (!svg) return null;
  const parts = [];
  for (const sh of svg.fills || []) {
    if (!sh.outer || sh.outer.length < 3) continue;
    parts.push(CS().ofPolygons([sh.outer, ...(sh.holes || [])], 'EvenOdd'));
  }
  const st = strokesSection(svg.strokes || []);
  if (st) parts.push(st);
  if (!parts.length) return null;
  return CS().union(parts);
}

/** Celdas del patrón elegido dentro de `area`. */
function cellsFor(D, P, area, kind) {
  if (kind === 'hex') return hexCells(D, P, area);
  if (kind === 'stripes') return stripeCells(D, P, area);
  if (kind === 'cross') return crossCells(D, P, area);
  if (kind === 'circuit') return circuitCells(D, P, area);
  if (kind === 'radial') return radialCells(D, P, area);
  return null;
}

/**
 * Relieve final de la tapa (marco interno).
 *
 * Modo apilable: la tapa se imprime boca abajo, así que su cara superior es la
 * primera capa. El marco de apilado y una retícula de nervios (hexagonal por
 * defecto) apoyan en la cama; la piel de la tapa se imprime encima como
 * puentes cortos entre nervios. Los patrones de líneas (circuito, radial) se
 * añaden en relieve sobre esa retícula.
 * @returns {{cut, add, warn}}
 */
export function lidRelief(D, P, svg) {
  const warn = [];
  const zTop = D.Hb + D.Hl;
  let logo = logoSection(svg);

  if (D.stack) {
    // Interfaz de apilado: marco con cara exterior a 45° (continúa el bisel
    // del borde de la tapa: asiento cónico) + nervios paralelos al lado
    // largo, altura hs. Impresa boca abajo, marco y nervios apoyan en la cama
    // y la piel solo puentea entre nervios (≤ 0.8·maxBridge: sin soportes).
    const o0 = D.t - D.db;                         // cara exterior del marco en zTop
    const inner = rrOffset(D, D.frameIn);
    const frame = frustum(rrOffset(D, o0), zTop - 0.01, rrOffset(D, o0 - D.hs), zTop + D.hs)
      .subtract(prism(inner, zTop - 1, zTop + D.hs + 1));
    let ribs = stackLines(D, D.rw, 400);
    ribs = ribs ? ribs.intersect(inner.offset(-0.01)) : null;
    // Garantía: cualquier zona entre nervios más ancha que el límite (p. ej.
    // en un octógono) recibe un nervio extra.
    const free = ribs ? inner.subtract(ribs) : inner;
    const lim = limitBridges(free, D.maxBridge, D.rw);
    if (lim.split) ribs = inner.subtract(lim.cs || CS());
    if (D.pattern !== 'smooth' || logo) warn.push(Msg('warn.stackNoPattern'));
    return { cut: null, add: ribs ? frame.add(prism(ribs, zTop - 0.01, zTop + D.hs)) : frame, warn };
  }

  const area = patternArea(D, P);
  let cells = cellsFor(D, P, area, D.pattern);
  if (logo) logo = logo.intersect(area);
  if (logo && logo.isEmpty()) logo = null;
  if (logo && cells) cells = cells.subtract(logo.offset(P.patternRib, 'Round', 2, 16));
  const maxW = D.maxBridge || 10;

  if (D.relief === 'engrave') {
    // Cavidades = puentes al imprimir boca abajo.
    const lim = limitBridges(cells, maxW, P.patternRib);
    cells = lim.cs;
    if (lim.split) warn.push(Msg('warn.patternBridges', { n: lim.split, mm: maxW }));
    if (logo && widerThan(logo, maxW)) warn.push(Msg('warn.logoBridges', { mm: maxW }));
    const region = unionAll([cells, logo]);
    if (!region || region.isEmpty()) return { cut: null, add: null, warn };
    return { cut: prism(region, zTop - D.pd, zTop + 1), add: null, warn };
  }
  // Relieve: marco perimetral + nervios + logo.
  const lineArt = D.pattern === 'circuit' || D.pattern === 'radial';
  let raised;
  if (cells && !lineArt) {
    raised = area.subtract(cells);
    if (logo) raised = raised.subtract(logo.offset(P.patternRib, 'Round', 2, 16));
  } else {
    raised = area.subtract(area.offset(-Math.max(2, P.patternRib * 1.5), 'Round', 2, 24));
    if (lineArt && cells) raised = raised.add(cells);
  }
  if (logo) raised = raised.add(logo);
  // El borde (fuera del área del patrón) lo completa buildLid con la huella
  // real de la cara superior (nervios de esquina y de pared incluidos).
  // Lo que no está en relieve es un techo en el aire (impresión boca abajo).
  const lim = limitBridges(area.subtract(raised), maxW, P.patternRib);
  if (lim.split) {
    raised = lim.cs ? area.subtract(lim.cs) : area;
    warn.push(Msg('warn.embossBridges', { n: lim.split, mm: maxW }));
  }
  return { cut: null, add: prism(raised, zTop - 0.01, zTop + D.pd), warn };
}
