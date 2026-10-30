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
 * Inserto de la BASE.
 * @param contentPolys polígonos del contenido en el marco interno (o null)
 * @returns { solid (marco nativo, z = suelo útil), print, height, info }
 */
export function baseInsert(D, P, contentPolys) {
  const tol = P.insertTol ?? 0.3;
  const wallT = 2 * D.lw;
  const deck = Math.max(4 * D.lh, P.insertDeck || 1.6);
  const H = P.insertH > 0 ? Math.min(P.insertH, D.Db) : Math.max(deck + 2, D.Db - 0.5);
  const fcE = D.fc > 0 ? D.fc + tol : 0;
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
  // `contentObjects` = [{ polys, notches }] ya acomodados (packer.js); si solo
  // llega `contentPolys` (un objeto), los huecos se calculan aquí.
  let pocket = null;
  const objsIn = P.contentObjects && P.contentObjects.length ? P.contentObjects
    : contentPolys && contentPolys.length ? [{ polys: contentPolys, notches: null }] : null;
  if (P.insertMode === 'pockets' && objsIn) {
    const tolP = P.pocketTol ?? 0.6;
    const r = (P.fingerD || 20) / 2;
    const regions = [];
    const notchesAll = [];
    for (const o of objsIn) {
      const obj = CS().union(o.polys.map((p) => CS().ofPolygons([p], 'EvenOdd')));
      let reg = obj.offset(tolP, 'Round', 2, 24);
      let centers = o.notches;
      if (!centers) centers = fingerNotches(obj, o.polys.flat(), P).centers;
      for (const c of centers) { reg = reg.add(CS().circle(r, 40).translate(c)); notchesAll.push(c); }
      regions.push(reg);
    }
    // Nunca romper la pared exterior del inserto.
    let region = CS().union(regions).intersect(rr(-tol - wallT - 0.8));
    // Vista rápida: contorno simplificado a 0.15 mm (un calco detallado tiene
    // cientos de vértices y cada booleano 3D con él cuesta decenas de ms).
    if (D.draft) region = region.simplify(0.15);
    pocket = region;
    info.pockets = objsIn.length;
    info.notches = notchesAll.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    // Pared propia de cada alojamiento (cierra el hueco interior del inserto).
    const ring = region.offset(wallT, 'Round', 2, 24).subtract(region).intersect(rr(-tol - 0.01));
    solid = solid.add(prism(ring, 0, H));
  }

  // Nervios bajo la cubierta (retícula ~40 mm): rigidez y apoyo en el suelo.
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
  // envolvente achaflanada (pisarían el chaflán del suelo de la caja).
  solid = solid.intersect(outer);
  if (pocket) {
    solid = solid.subtract(prism(pocket, -1, H + 1));
    // Chaflán de entrada de 0.6 mm (guía al meter el objeto).
    // (Escalonado: el alojamiento no es convexo; un frustum —envolvente
    // convexa— se comía la cubierta entre huecos en los primeros 0.6 mm.)
    // Es un detalle: la vista rápida lo omite.
    if (!D.draft) solid = solid.subtract(steppedChamfer(pocket, H - 0.6, H + 0.01, 0.6, D.lh));
  }
  solid = solid.translate([0, 0, D.floorTop]);
  // Impresión: cubierta sobre la cama (voltear en Z e Y).
  const zTop = D.floorTop + H;
  const print = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, zTop, 1];
  return { solid, print, info };
}

/**
 * Inserto de la TAPA (en blanco): cubierta hacia los objetos (abajo con la caja
 * cerrada), paredes hacia el techo. Mantiene los objetos sujetos.
 */
export function lidInsert(D, P) {
  if (D.Dl < 3) return null;
  const tol = P.insertTol ?? 0.3;
  const wallT = 2 * D.lw;
  const deck = Math.max(4 * D.lh, P.insertDeck || 1.6);
  const H = Math.max(deck + 1, D.Dl - 0.3);
  const fcE = D.fcl > 0 ? D.fcl + tol : 0;
  const rr = (d) => rrOffset(D, d);
  const zi = D.Hb + D.Dl;                 // techo interior de la tapa
  // En coordenadas locales: z = 0 cubierta (abajo), z = H contra el techo.
  const outer = unionAll([prism(rr(-tol), 0, H - fcE), fcE > 0 ? frustum(rr(-tol), H - fcE, rr(-tol - fcE), H) : null]);
  const hollow = unionAll([
    prism(rr(-tol - wallT), deck, H - fcE + 0.01),
    fcE > 0 ? frustum(rr(-tol - wallT), H - fcE, rr(-tol - fcE - wallT), H + 0.01) : null,
  ]);
  let solid = outer.subtract(hollow);
  const inner = rr(-tol - wallT);
  const b = inner.bounds();
  const strips = [];
  const nX = Math.floor((b.max[0] - b.min[0]) / 40), nY = Math.floor((b.max[1] - b.min[1]) / 40);
  for (let i = 1; i <= nX; i++) { const x = b.min[0] + ((b.max[0] - b.min[0]) * i) / (nX + 1); strips.push(CS().square([wallT, b.max[1] - b.min[1] + 2], false).translate([x - wallT / 2, b.min[1] - 1])); }
  for (let j = 1; j <= nY; j++) { const y = b.min[1] + ((b.max[1] - b.min[1]) * j) / (nY + 1); strips.push(CS().square([b.max[0] - b.min[0] + 2, wallT], false).translate([b.min[0] - 1, y - wallT / 2])); }
  if (strips.length) solid = solid.add(prism(CS().union(strips).intersect(inner), deck - 0.01, H - fcE));
  solid = solid.translate([0, 0, zi - H]);
  const print = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -(zi - H), 1];   // cubierta ya abajo
  return { solid, print, info: { height: Math.round(H * 100) / 100 } };
}

