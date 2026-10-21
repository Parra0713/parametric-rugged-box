/**
 * geo.js — Utilidades geométricas sobre manifold-3d.
 *
 * manifold-3d es un núcleo CSG en C++ compilado a WebAssembly. Garantiza
 * mallas cerradas ("watertight") en cada operación booleana, lo que evita los
 * errores de no‑manifold típicos al exportar a STL y es 10–1000× más rápido
 * que el CGAL de OpenSCAD.
 *
 * Gestión de memoria: los objetos de WASM no los libera el recolector de
 * basura de JavaScript. `installGC()` intercepta todos los constructores y
 * métodos que devuelven geometría nueva y los registra; al terminar cada
 * reconstrucción se llama `cleanup()` y se libera TODO de una vez. Así la
 * memoria permanece plana aunque el usuario arrastre deslizadores durante
 * minutos.
 */

let W = null;          // módulo wasm inicializado
const registry = [];   // objetos pendientes de liberar

const MANIFOLD_STATIC = ['cube', 'cylinder', 'sphere', 'tetrahedron', 'extrude', 'revolve',
  'compose', 'union', 'difference', 'intersection', 'levelSet', 'smooth', 'ofMesh', 'hull'];
const MANIFOLD_MEMBER = ['add', 'subtract', 'intersect', 'decompose', 'warp', 'transform',
  'translate', 'rotate', 'scale', 'mirror', 'calculateNormals', 'refine', 'setProperties',
  'setTolerance', 'simplify', 'asOriginal', 'trimByPlane', 'split', 'splitByPlane', 'slice',
  'project', 'hull', 'extrude', 'revolve'];
const CS_STATIC = ['square', 'circle', 'union', 'difference', 'intersection', 'compose',
  'ofPolygons', 'hull'];
const CS_MEMBER = ['add', 'subtract', 'intersect', 'rectClip', 'decompose', 'transform',
  'translate', 'rotate', 'scale', 'mirror', 'simplify', 'offset', 'hull', 'extrude', 'revolve'];

function track(r) {
  if (Array.isArray(r)) r.forEach(track);
  else if (r && typeof r.delete === 'function') registry.push(r);
  return r;
}

function wrap(target, names) {
  for (const n of names) {
    const f = target[n];
    if (typeof f !== 'function' || f.__gc) continue;
    const g = function (...a) { return track(f.apply(this, a)); };
    g.__gc = true;
    target[n] = g;
  }
}

/** Inicializa el módulo y activa el registro automático. */
export function installGC(wasm) {
  W = wasm;
  wrap(W.Manifold, MANIFOLD_STATIC);
  wrap(W.Manifold.prototype, MANIFOLD_MEMBER);
  wrap(W.CrossSection, CS_STATIC);
  wrap(W.CrossSection.prototype, CS_MEMBER);
}

/** Libera todos los objetos WASM creados desde la última llamada. */
export function cleanup() {
  for (const o of registry) { try { o.delete(); } catch { /* ya liberado */ } }
  registry.length = 0;
}

export const M = () => W.Manifold;
export const CS = () => W.CrossSection;

/* ------------------------------------------------------------------------ */
/*  Primitivas 2D                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Rectángulo redondeado centrado (L × W, radio r). Construido como cuadrado
 * reducido + offset redondo → tangencias exactas y convexo.
 */
export function roundRect(L, W2, r, seg) {
  r = Math.max(0, Math.min(r, L / 2 - 1e-3, W2 / 2 - 1e-3));
  if (r < 0.01) return CS().square([L, W2], true);
  return CS().square([L - 2 * r, W2 - 2 * r], true).offset(r, 'Round', 2, seg);
}

/** Polígono 2D simple a partir de una lista de puntos [[x,y],…]. */
export function poly(pts) {
  return CS().ofPolygons([pts.map((p) => [p[0], p[1]])], 'NonZero');
}

/** Círculo centrado en (cx, cy). */
export function circle(cx, cy, r, seg) {
  return CS().circle(r, seg).translate([cx, cy]);
}

/**
 * Agujero "teardrop": círculo con un vértice a 45° hacia arriba (+v) o abajo.
 * Un agujero horizontal impreso necesita esta forma para no requerir soporte:
 * cada capa se apoya en la anterior con un voladizo ≤ 45°.
 */
export function teardrop(cu, cv, r, up, seg) {
  const s = up ? 1 : -1;
  const tip = r * Math.SQRT2;
  const tri = poly([[cu - 0.01, cv], [cu + 0.01, cv], [cu, cv + s * tip]]);
  return CS().hull([circle(cu, cv, r, seg), tri]);
}

/* ------------------------------------------------------------------------ */
/*  Primitivas 3D                                                           */
/* ------------------------------------------------------------------------ */

/** Extruye una sección XY entre z0 y z1. */
export function prism(cs, z0, z1) {
  return cs.extrude(z1 - z0).translate([0, 0, z0]);
}

/**
 * Tronco entre dos secciones convexas a alturas z0 y z1 (casco convexo de dos
 * láminas finas). Se usa para chaflanes de 45° exactos en contornos
 * redondeados: el offset en 2D desplaza la arista sin deformar los radios.
 */
export function frustum(csA, z0, csB, z1) {
  const e = 1e-3;
  const a = csA.extrude(e).translate([0, 0, z0]);
  const b = csB.extrude(e).translate([0, 0, z1 - e]);
  return M().hull([a, b]);
}

/**
 * Chaflán de 45° para secciones NO convexas (frustum usa la envolvente
 * convexa y rellenaría el espacio entre huecos). Escalones de una capa:
 * en z0 la sección original, en z1 la sección crecida `d` (z0 < z1).
 */
export function steppedChamfer(cs, z0, z1, d, lh = 0.2) {
  const n = Math.max(2, Math.round((z1 - z0) / lh));
  const steps = [];
  for (let i = 0; i < n; i++) {
    const za = z0 + ((z1 - z0) * i) / n, zb = z0 + ((z1 - z0) * (i + 1)) / n;
    const off = (d * (i + 0.5)) / n;
    steps.push(prism(off > 0.01 ? cs.offset(off, 'Round', 2, 24) : cs, za, zb + 1e-3));
  }
  return M().union(steps);
}

// Matriz (columna mayor) que lleva (u, v, w) → (y, z, x).
const YZ = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];

/**
 * Extruye un perfil dibujado en el plano (u=Y, v=Z) a lo largo de X entre x0 y
 * x1. Bisagras, orejetas, retenes y cierres son perfiles 2D extruidos: así la
 * geometría que importa (radios, chaflanes de 45°) se controla en 2D.
 */
export function yzExtrude(cs, x0, x1) {
  return cs.extrude(x1 - x0).transform(YZ).translate([x0, 0, 0]);
}

/** Cilindro de eje X entre x0 y x1, centrado en (y, z). */
export function xCylinder(x0, x1, y, z, r, seg) {
  return yzExtrude(circle(y, z, r, seg), x0, x1);
}

/** Une una lista de sólidos (o de secciones 2D), ignorando vacíos. */
export function unionAll(list) {
  const l = list.filter(Boolean);
  if (l.length === 0) return null;
  if (l.length === 1) return l[0];
  return (l[0] instanceof W.CrossSection ? CS() : M()).union(l);
}

/** Exporta la malla con normales planas por arista viva (para el visor). */
export function toMesh(man, withNormals = true) {
  // Normales en las propiedades 3..5; las aristas de más de 35° se separan
  // para que las caras planas se vean nítidas (sombreado tipo CAD).
  const m = withNormals ? man.calculateNormals(0, 35) : man;
  const mesh = m.getMesh();
  return {
    numProp: mesh.numProp,
    vert: new Float32Array(mesh.vertProperties),
    tri: new Uint32Array(mesh.triVerts),
  };
}
