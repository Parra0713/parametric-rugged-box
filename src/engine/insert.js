/**
 * insert.js — Insertos interiores a medida (base y tapa).
 *
 * Diseño (optimizado en material, tiempo y fiabilidad):
 *
 *        cubierta (deck) ────────────────────────────  ← cara de trabajo
 *        │  │      │╲  alojamiento  ╱│       │  │
 *        │  │ nervio│ │  (pasante)  │ │pared │  │      hueco por debajo:
 *        │  │      │ │             │ │       │  │      sin relleno macizo
 *        ┴──┴──────┴─┴─────────────┴─┴───────┴──┴──
 *          pared exterior                          suelo de la caja
 *
 *  - Sigue EXACTAMENTE la forma interior (rectángulo redondeado u octógono),
 *    con holgura `insertTol` y el chaflán inferior que exige el chaflán
 *    anti‑contracción del suelo.
 *  - Solo paredes laterales (2 líneas) + cubierta: hueco por debajo. Una
 *    retícula de nervios cada ~40 mm sostiene la cubierta y hace de patas.
 *  - Con contorno SVG del contenido: alojamientos PASANTES (el objeto apoya
 *    en el suelo de la caja: no se gasta material en fondos) con su propia
 *    pared, chaflán de entrada y huecos para los dedos.
 *  - Se imprime con la cubierta sobre la cama: nada en voladizo, la cara de
 *    trabajo sale con el acabado de la cama.
 *
 * Referencias de práctica habitual (generadores de bandejas por calco):
 * holgura objeto‑alojamiento 0.5–3 mm y huecos para dedo de Ø20 mm
 * (Tooltrace), alojamientos pasantes o con profundidad única por bandeja.
 */
import { CS, prism, frustum, unionAll, steppedChamfer } from './geo.js';
import { rrOffset } from './seal.js';

/** Eje principal (PCA) de un polígono: centroide, dirección mayor y menor. */
function principal(pts, cs) {
  // Centro: el de la caja envolvente de la sección (robusto frente a contornos
  // con muchos vértices concentrados en un extremo).
  const b = cs.bounds();
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { cx, cy, u: [Math.cos(a), Math.sin(a)], v: [-Math.sin(a), Math.cos(a)] };
}

/** Distancia hasta el último cruce del rayo (o + t·d) con el contorno. */
function rayExit(cs, o, d) {
  let best = 0;
  for (const c of cs.toPolygons()) {
    for (let i = 0; i < c.length; i++) {
      const [ax, ay] = c[i], [bx, by] = c[(i + 1) % c.length];
      const ex = bx - ax, ey = by - ay;
      const den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - o[0]) * ey - (ay - o[1]) * ex) / den;
      const s = ((ax - o[0]) * d[1] - (ay - o[1]) * d[0]) / den;
      if (t > 0 && s >= 0 && s <= 1 && t > best) best = t;
    }
  }
  return best;
}

/**
 * Huecos para los dedos: dos círculos en los bordes opuestos del objeto,
 * sobre su eje menor (por donde se agarra), desplazables a lo largo del eje
 * mayor. Se colocan medio dentro y medio fuera del alojamiento.
 */
function fingerNotches(objCs, pts, P) {
  const n = P.fingerCount === 'auto' ? 2 : Number(P.fingerCount);
  if (!n) return { cs: null, centers: [] };
  const { cx, cy, u, v } = principal(pts, objCs);
  // Semieje mayor (extensión a lo largo de u).
  let umax = 0;
  for (const [x, y] of pts) umax = Math.max(umax, Math.abs((x - cx) * u[0] + (y - cy) * u[1]));
  const s = ((P.fingerPos || 0) / 100) * umax;
  const o = [cx + u[0] * s, cy + u[1] * s];
  const r = (P.fingerD || 20) / 2;
  const sides = n === 1 ? [1] : [1, -1];
  const centers = [];
  const circles = [];
  for (const sg of sides) {
    const d = [v[0] * sg, v[1] * sg];
    const t = rayExit(objCs, o, d);
    const c = [o[0] + d[0] * t, o[1] + d[1] * t];
    centers.push(c);
    circles.push(CS().circle(r, 40).translate(c));
  }
  return { cs: CS().union(circles), centers };
}

/**
 * Núcleo común de los insertos, en coordenadas locales: z = 0 es el lado
 * que apoya en el fondo de su mitad (suelo de la base / techo de la tapa) y
 * z = H la cubierta (cara de trabajo, hacia los objetos).
 * @param o { depth, fc, H, objs } profundidad y chaflán interior de esa
 *   mitad, altura del inserto y objetos [{ polys, notches }] (o null)
 */
function insertCore(D, P, o) {
  const tol = P.insertTol ?? 0.3;
  const wallT = 2 * D.lw;
  const deck = Math.max(4 * D.lh, P.insertDeck || 1.6);
  const H = o.H;
  const fcE = o.fc > 0 ? o.fc + tol : 0;
  const rr = (d) => rrOffset(D, d);

  const outer = unionAll([
    fcE > 0 ? frustum(rr(-tol - fcE), 0, rr(-tol), fcE) : null,
    prism(rr(-tol), fcE, H),
  ]);
  const hollow = unionAll([
    fcE > 0 ? frustum(rr(-tol - fcE - wallT), -0.01, rr(-tol - wallT), fcE) : null,
    prism(rr(-tol - wallT), fcE > 0 ? fcE - 0.01 : -0.01, H - deck),
  ]);
  let solid = outer.subtract(hollow);
  const info = { height: Math.round(H * 100) / 100, pockets: 0, notches: [] };

  // Alojamientos del contenido (+ huecos para los dedos).
  let pocket = null;
  if (o.objs) {
    const tolP = P.pocketTol ?? 0.6;
    const r = (P.fingerD || 20) / 2;
    const regions = [];
    const notchesAll = [];
    for (const ob of o.objs) {
      const obj = CS().union(ob.polys.map((p) => CS().ofPolygons([p], 'EvenOdd')));
      let reg = obj.offset(tolP, 'Round', 2, 24);
      let centers = ob.notches;
      if (!centers) centers = fingerNotches(obj, ob.polys.flat(), P).centers;
      for (const c of centers) { reg = reg.add(CS().circle(r, 40).translate(c)); notchesAll.push(c); }
      regions.push(reg);
    }
    // Nunca romper la pared exterior del inserto.
    let region = CS().union(regions).intersect(rr(-tol - wallT - 0.8));
    // Vista rápida: contorno simplificado a 0.15 mm (un calco detallado tiene
    // cientos de vértices y cada booleano 3D con él cuesta decenas de ms).
    if (D.draft) region = region.simplify(0.15);
    pocket = region;
    info.pockets = o.objs.length;
    info.notches = notchesAll.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    // Pared propia de cada alojamiento (cierra el hueco interior del inserto).
    const ring = region.offset(wallT, 'Round', 2, 24).subtract(region).intersect(rr(-tol - 0.01));
    solid = solid.add(prism(ring, 0, H));
  }

  // Nervios bajo la cubierta (retícula ~40 mm): rigidez y apoyo en el fondo.
  const inner = rr(-tol - wallT);
  const b = inner.bounds();
  const pitch = P._eco ? 60 : 40, t = wallT;                 // modo ahorro: nervios más espaciados
  const strips = [];
  const nX = Math.floor((b.max[0] - b.min[0]) / pitch), nY = Math.floor((b.max[1] - b.min[1]) / pitch);
  for (let i = 1; i <= nX; i++) {
    const x = b.min[0] + ((b.max[0] - b.min[0]) * i) / (nX + 1);
    strips.push(CS().square([t, b.max[1] - b.min[1] + 2], false).translate([x - t / 2, b.min[1] - 1]));
  }
  for (let j = 1; j <= nY; j++) {
    const y = b.min[1] + ((b.max[1] - b.min[1]) * j) / (nY + 1);
    strips.push(CS().square([b.max[0] - b.min[0] + 2, t], false).translate([b.min[0] - 1, y - t / 2]));
  }
  if (strips.length) {
    let ribs = CS().union(strips).intersect(inner);
    if (pocket) ribs = ribs.subtract(pocket);
    solid = solid.add(prism(ribs, fcE, H - deck + 0.01));
  }

  // Paredes de huecos y nervios pegados al borde no pueden salirse de la
  // envolvente achaflanada (pisarían el chaflán del fondo de la caja).
  solid = solid.intersect(outer);
  if (pocket) {
    solid = solid.subtract(prism(pocket, -1, H + 1));
    // Chaflán de entrada de 0.6 mm (guía al meter el objeto).
    // (Escalonado: el alojamiento no es convexo; un frustum —envolvente
    // convexa— se comía la cubierta entre huecos en los primeros 0.6 mm.)
    // Es un detalle: la vista rápida lo omite.
    if (!D.draft) solid = solid.subtract(steppedChamfer(pocket, H - 0.6, H + 0.01, 0.6, D.lh));
  }
  return { solid, info, deck };
}

/** Objetos del contenido para un inserto con huecos (o null si va en blanco). */
function objectsOf(P, contentPolys, pockets) {
  if (!pockets) return null;
  return P.contentObjects && P.contentObjects.length ? P.contentObjects
    : contentPolys && contentPolys.length ? [{ polys: contentPolys, notches: null }] : null;
}

/**
 * Inserto de la BASE: apoya en el suelo, cubierta arriba.
 * @param contentPolys polígonos del contenido en el marco interno (o null)
 * @param pockets con alojamientos para el contenido (si no, en blanco)
 * @returns { solid (marco nativo), print, info }
 */
export function baseInsert(D, P, contentPolys, pockets = P.insertMode === 'pockets') {
  const deck = Math.max(4 * D.lh, P.insertDeck || 1.6);
  const H = P.insertH > 0 ? Math.min(P.insertH, D.Db) : Math.max(deck + 2, D.Db - 0.5);
  const core = insertCore(D, P, { fc: D.fc, H, objs: objectsOf(P, contentPolys, pockets) });
  const solid = core.solid.translate([0, 0, D.floorTop]);
  // Impresión: cubierta sobre la cama (voltear en Z e Y).
  const zTop = D.floorTop + H;
  const print = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, zTop, 1];
  return { solid, print, info: core.info };
}

/**
 * Inserto de la TAPA: el mismo inserto girado 180° sobre X (y → −y, z → −z)
 * y colgado del techo: cubierta hacia los objetos (abajo con la caja
 * cerrada), paredes hacia el techo. En blanco los sujeta; con huecos, aloja
 * lo que sobresale de la base (o guarda los objetos en la tapa).
 * El contenido se refleja en Y antes de girar: cae en su sitio en el mundo.
 */
export function lidInsert(D, P, contentPolys = null, pockets = false) {
  if (D.Dl < 3) return null;
  const deck = Math.max(4 * D.lh, P.insertDeck || 1.6);
  const H = Math.max(deck + 1, D.Dl - 0.3);
  const src = objectsOf(P, contentPolys, pockets);
  const flipY = (p) => [p[0], -p[1]];
  const objs = src && src.map((o) => ({ polys: o.polys.map((q) => q.map(flipY)), notches: o.notches ? o.notches.map(flipY) : null }));
  const core = insertCore(D, P, { fc: D.fcl, H, objs });
  const zi = D.Hb + D.Dl;                 // techo interior de la tapa
  const solid = core.solid.transform([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, zi, 1]);
  const print = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -(zi - H), 1];   // cubierta ya abajo
  // Huecos para dedos en coordenadas del mundo (se reflejaron para modelar).
  core.info.notches = core.info.notches.map(([x, y]) => [x, -y]);
  return { solid, print, info: core.info };
}
