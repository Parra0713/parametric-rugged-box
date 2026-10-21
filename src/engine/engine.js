/**
 * engine.js — Orquestador: de parámetros a piezas listas para ver e imprimir.
 *
 * Convenciones de coordenadas
 *   - Marco interno: caja cerrada, interior centrado, X = lado largo, frente
 *     (cierres) = −Y, trasera (bisagras) = +Y, fondo del CUERPO de la base en
 *     z = 0 (pies Gridfinity en z < 0; la instancia los sube con z0).
 *     Si D.rot90, el visor gira el conjunto 90° para mostrar la orientación
 *     que pidió el usuario (la impresión no cambia).
 *   - Cada pieza devuelve:
 *       mesh       → malla en su marco nativo
 *       print      → matriz 4×4 (columna mayor) nativo → orientación de impresión
 *       instances  → matrices nativo → ensamblaje (una por copia)
 *       aids       → mallas auxiliares ya en coordenadas de impresión
 *                    (orejas anti‑warping, cuna de soporte)
 */
import { installGC, cleanup, prism, frustum, unionAll, toMesh, M, CS, roundRect } from './geo.js';
import { derive } from './params.js';
import { rrOffset, grooveCut, tongues, gasket } from './seal.js';
import { hinges, knuckleSpans } from './hinge.js';
import { latches } from './latch.js';
import { printedPin, filamentCap, filamentLength } from './pins.js';
import { gridfinityFeet } from './gridfinity.js';
import { lidRelief } from './pattern.js';
import { transformVerts, hull2D, fitAngle, tiltSolve } from '../bedfit.js';

/* ---------------- Matrices 4×4 (columna mayor) ---------------- */
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
function mul(a, b) {                 // a·b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const ZX = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];      // z→x, x→y, y→z
const ROTZ180 = [-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

let ready = false;

/** Inicializa el módulo WASM (una sola vez). */
export async function init(ModuleFactory, wasmUrl) {
  if (ready) return;
  const wasm = await ModuleFactory(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  wasm.setup();
  installGC(wasm);
  ready = true;
}

/* ================================================================ */
/*  Línea de contracción: análisis por capa + ranuras de sombra      */
/* ================================================================ */

/**
 * Busca las alturas donde el tiempo de capa cae de golpe.
 *
 * El tiempo que tarda una capa es, en primera aproximación, proporcional a
 * su área de material. Donde el área cae bruscamente (fondo macizo → solo
 * paredes) la capa siguiente se imprime sobre plástico aún caliente y con
 * menos tiempo para enfriarse; además, el último relleno macizo se contrae
 * tirando de los perímetros. El resultado es la "línea de contracción".
 *
 * Indicador: s(z) = ln(A(z − 2·lh) / A(z + 2·lh)), ventana de ±2 capas. Se
 * marca como crítica toda caída > 40 % (s > ln 1.67) que sea máximo local.
 * @param man  sólido en orientación de impresión (z ≥ 0)
 * @returns [{ z, drop }] alturas críticas en el marco de impresión
 */
export function criticalLayers(man, lh, zMax) {
  const n = Math.min(400, Math.floor(zMax / lh));
  const A = [];
  for (let k = 0; k < n; k++) A.push(man.slice((k + 0.5) * lh).area());
  const out = [];
  const s = (k) => (k < 2 || k > n - 3 || A[k + 2] <= 1e-6 ? 0 : Math.log(A[k - 2] / A[k + 2]));
  for (let k = 2; k < n - 2; k++) {
    const v = s(k);
    if (v > Math.log(1 / 0.6) && v >= s(k - 1) && v > s(k + 1)) {
      // La transición real empieza en la primera capa con caída.
      let k0 = k;
      while (k0 > 1 && A[k0 - 1] / A[k0] > 1.08) k0--;
      out.push({ z: Math.round(k0 * lh * 100) / 100, drop: Math.round((1 - A[k + 2] / A[k - 2]) * 100) });
    }
  }
  // Fusiona las que caen a menos de 3 mm (misma transición).
  const merged = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && c.z - last.z < 3) { if (c.drop > last.drop) last.drop = c.drop; } else merged.push(c);
  }
  return merged;
}

/** Ranura en V de 90° sobre la superficie `off` (offset del interior) a altura z. */
function vGroove(D, off, z) {
  const v = D.shadowV;
  const rr = (d) => rrOffset(D, d);
  const vee = unionAll([frustum(rr(off), z - v, rr(off - v), z), frustum(rr(off - v), z, rr(off), z + v)]);
  return prism(rr(off + 1.5), z - v, z + v).subtract(vee);
}

/** Zonas de esquina (2D) para los nervios/parachoques. */
function cornerZones(D) {
  const ex = D.Lo / 2 - D.ro - D.cw, ey = D.Wo / 2 - D.ro - D.cw;
  const big = 200;
  const zs = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    zs.push(CS().square([big, big], false).translate([sx > 0 ? ex : -ex - big, sy > 0 ? ey : -ey - big]));
  }
  return CS().union(zs);
}

/* ================================================================ */
/*  Base                                                            */
/* ================================================================ */
function buildBase(D, H, L, report) {
  const rr = (d) => rrOffset(D, d);
  const { t, Hb, F, bo, floor } = D;

  // Chaflán interior limitado si hay placa Gridfinity (los bins de los
  // bordes no deben chocar con él).
  let fc = D.fc;
  if (D.gfPlate) {
    const m = Math.min((D.Li - D.gfNx * 42) / 2, (D.Wi - D.gfNy * 42) / 2) + 0.25;
    fc = Math.max(0, Math.min(fc, m - 0.1));
  }
  const ft = D.floorTop;

  const outer = D.gfFeet
    ? prism(rr(t), 0, Hb)
    : unionAll([frustum(rr(t - 0.5), 0, rr(t), 0.5), prism(rr(t), 0.5, Hb)]);
  // Banda con chaflán inferior de 45° (área de capa creciente, sin voladizos).
  const zb = Hb - D.bandH;
  const zc = Math.max(0, zb - bo);
  const band = unionAll([prism(rr(F), zb, Hb), frustum(rr(F - (zb - zc)), zc, rr(F), zb)]);
  // Cavidad con chaflán interior de 45° (frente 1: transición gradual).
  const cavity = unionAll([
    prism(rr(0), ft + fc, Hb + 1),
    fc > 0 ? frustum(rr(-fc), ft, rr(0), ft + fc) : prism(rr(0), ft, ft + fc + 0.01),
  ]);
  let core = unionAll([outer, band]).subtract(cavity);
  if (D.gfPlate) core = core.subtract(gridfinitySockets(D));

  // Frente 3: análisis por capas → ranuras de sombra donde cae el tiempo de capa.
  const crit = criticalLayers(core, D.lh, Hb);
  const zLo = D.stack ? D.hs + D.fw + D.sclr + 1 : 1.0;
  const zHi = zc - 1.2;
  const grooves = [];
  for (const c of crit) {
    const z = c.z;
    const ok = D.shadow && z - D.shadowV >= zLo && z + D.shadowV <= zHi;
    report.push({ part: 'Base', z, drop: c.drop, masked: ok ? 'ranura de sombra' : D.stack && z < zLo ? 'chaflán de apilado' : z >= zc - 1.2 ? 'banda' : 'no' });
    if (ok && grooves.length < 2) grooves.push(z);
  }
  for (const z of grooves) core = core.subtract(vGroove(D, t, z));

  // Frente 4: nervios de esquina (rompen la continuidad visual de cualquier
  // marca horizontal y protegen las esquinas en caídas).
  if (D.ribs) {
    let bump = unionAll([
      D.gfFeet ? prism(rr(F), 0, 0.5) : frustum(rr(F - 0.5), 0, rr(F), 0.5),
      prism(rr(F), 0.5, Hb),
    ]).intersect(prism(cornerZones(D).subtract(rr(t - 0.3)), -1, Hb + 1));   // solo por fuera de la pared
    for (const z of grooves) bump = bump.subtract(vGroove(D, F, z));
    core = core.add(bump);
  }

  let body = unionAll([core, H.base, L.lugs]);
  for (const g of grooveCut(D)) body = body.subtract(g);
  body = body.subtract(L.pockets).subtract(H.baseHoles).subtract(L.lugHoles);

  // Apilado: la parte inferior se estrecha (vertical + 45°) para encajar en
  // el marco de la tapa de la caja de abajo.
  if (D.stack) {
    const s0 = t - D.fw - D.sclr;
    const big = F + 20;
    const env = unionAll([
      frustum(rr(s0 - 0.4), 0, rr(s0), 0.4),
      prism(rr(s0), 0.4, D.hs),
      frustum(rr(s0), D.hs, rr(big), D.hs + (big - s0)),
      prism(rr(big), D.hs + (big - s0) - 0.01, Hb + 60),
    ]);
    body = body.intersect(env);
  }
  if (D.gfFeet) body = body.add(gridfinityFeet(D));
  return body;
}

/** Huecos de la placa base Gridfinity (perfil estándar, abiertos hasta el fondo). */
function gridfinitySockets(D) {
  const z = D.floor;
  const a = roundRect(36.3, 36.3, 1.15, D.seg);
  const b = roundRect(37.7, 37.7, 1.85, D.seg);
  const c = roundRect(42, 42, 4, D.seg);
  const cell = unionAll([
    frustum(a, z, b, z + 0.7),
    prism(b, z + 0.7, z + 2.5),
    frustum(b, z + 2.5, c, z + D.gbH),
    prism(c, z + D.gbH - 0.01, z + D.gbH + 0.4),
  ]);
  const cells = [];
  for (let i = 0; i < D.gfNx; i++) for (let j = 0; j < D.gfNy; j++) {
    cells.push(cell.translate([(i - (D.gfNx - 1) / 2) * 42, (j - (D.gfNy - 1) / 2) * 42, 0]));
  }
  return unionAll(cells);
}

/* ================================================================ */
/*  Tapa (marco interno; se voltea para imprimir)                   */
/* ================================================================ */
function lidFlip(D, extra) {
  const zMax = D.Hb + D.Hl + extra;
  return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, zMax, 1];
}

function buildLid(D, P, H, L, svg, report) {
  const rr = (d) => rrOffset(D, d);
  const { t, Hb, Hl, F, bo } = D;
  const fc = D.fcl;
  const zB = Hb, zT = Hb + Hl;
  const outer = unionAll([prism(rr(t), zB, zT - 0.5), frustum(rr(t), zT - 0.5, rr(t - 0.5), zT)]);
  const zbt = zB + D.bandHl;
  const zc = Math.min(zT - 0.5, zbt + bo);
  const band = unionAll([prism(rr(F), zB, zbt), frustum(rr(F), zbt, rr(F - (zc - zbt)), zc)]);
  const zi = zT - D.topT;
  const cavity = D.Dl > 0.05 ? unionAll([
    prism(rr(0), zB - 1, zi - fc),
    fc > 0 ? frustum(rr(0), zi - fc, rr(-fc), zi) : null,
  ]) : null;
  let core = unionAll([outer, band]);
  if (cavity) core = core.subtract(cavity);

  // Análisis en orientación de impresión (boca abajo).
  const flip = lidFlip(D, 0);
  const crit = criticalLayers(core.transform(flip), D.lh, Hl);
  const grooves = [];
  for (const c of crit) {
    const zw = Math.round((zT - c.z) * 100) / 100;           // altura en mundo
    const ok = D.shadow && zw + D.shadowV <= zT - 1.0 && zw - D.shadowV >= zc + 1.0;
    report.push({ part: 'Tapa', z: c.z, drop: c.drop, masked: ok ? 'ranura de sombra' : zw < zc + 1 ? 'banda' : 'no' });
    if (ok && grooves.length < 2) grooves.push(zw);
  }
  for (const z of grooves) core = core.subtract(vGroove(D, t, z));

  if (D.ribs) {
    let bump = unionAll([prism(rr(F), zB, zT - 0.5), frustum(rr(F), zT - 0.5, rr(F - 0.5), zT)])
      .intersect(prism(cornerZones(D).subtract(rr(t - 0.3)), zB - 1, zT + 1));
    for (const z of grooves) bump = bump.subtract(vGroove(D, F, z));
    core = core.add(bump);
  }

  let lid = unionAll([core, H.lid, L.lidCheeks, L.keepers, ...tongues(D)]);
  lid = lid.subtract(H.lidHoles);
  const rel = lidRelief(D, P, svg);
  if (rel.cut) lid = lid.subtract(rel.cut);
  if (rel.add) lid = lid.add(rel.add);
  return { lid, warn: rel.warn };
}

/* ================================================================ */
/*  Ayudas de impresión: orejas y cuna                              */
/* ================================================================ */

/**
 * Orejas anti‑warping ("mouse ears"): discos de 2 capas en las esquinas de la
 * huella. En piezas largas o colocadas en diagonal las esquinas son el punto
 * donde se acumula la tensión de contracción y empieza el despegue; un disco
 * de Ø16 mm multiplica el área de anclaje local y se corta con un cúter.
 */
function earsFor(D, xyz) {
  let best = [[-Infinity], [-Infinity], [-Infinity], [-Infinity]];
  const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < xyz.length; i += 3) {
    if (xyz[i + 2] > 0.3) continue;                     // solo la primera capa
    dirs.forEach(([a, b], k) => {
      const v = a * xyz[i] + b * xyz[i + 1];
      if (v > best[k][0]) best[k] = [v, xyz[i], xyz[i + 1]];
    });
  }
  const discs = best.filter((b) => b[0] > -Infinity).map(([, x, y]) =>
    CS().circle(8, 32).translate([x, y]));
  if (!discs.length) return null;
  return prism(CS().union(discs), 0, 2 * D.lh);
}

/**
 * Cuna de soporte para piezas que solo caben inclinadas.
 * La cara de apoyo original de la pieza es plana, así que después de
 * inclinarla, todo el material queda por encima de ese plano: la cuna es la
 * cuña bajo dicho plano, con
 *  - una placa inferior maciza de 3 capas (máxima superficie sobre la cama),
 *  - nervios verticales cada 12 mm y un anillo perimetral (ligera y estable),
 *  - una separación de 1 capa con la pieza (interfaz desprendible).
 */
function cradleFor(D, printSolid, tiltM) {
  const gap = D.lh;
  // Contorno exterior convexo de la cara de apoyo (ignora grabados y huecos).
  const outline = printSolid.slice(0.05).hull().offset(-0.6, 'Round', 2, 16);
  if (outline.isEmpty()) return null;
  const wedge = prism(outline, -400, -gap).transform(tiltM).trimByPlane([0, 0, 1], 0);
  const inner = prism(outline.offset(-1.2, 'Round', 2, 16), -401, -gap + 1).transform(tiltM);
  const ring = wedge.subtract(inner);
  const bb = wedge.boundingBox();
  // Retícula 2D (rápida) extruida una sola vez y recortada por la cuña.
  const strips = [];
  const W2 = bb.max[1] - bb.min[1] + 2, L2 = bb.max[0] - bb.min[0] + 2;
  for (let x = Math.ceil(bb.min[0] / 12) * 12; x <= bb.max[0]; x += 12)
    strips.push(CS().square([1.2, W2], false).translate([x - 0.6, bb.min[1] - 1]));
  for (let y = Math.ceil(bb.min[1] / 12) * 12; y <= bb.max[1]; y += 12)
    strips.push(CS().square([L2, 1.2], false).translate([bb.min[0] - 1, y - 0.6]));
  const lattice = strips.length ? prism(CS().union(strips), 0, bb.max[2] + 1).intersect(wedge) : null;
  const plate = wedge.intersect(M().cube([2000, 2000, 3 * D.lh]).translate([-1000, -1000, 0]));
  return unionAll([ring, lattice, plate]);
}

function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }

/**
 * Decide las ayudas para una pieza grande (base o tapa).
 * Modifica `pt.print` si hay que inclinarla y añade `pt.aids`.
 */
function addAids(D, P, pt, solidNative) {
  if (P.printAids === 'off') return;
  const bed = { x: P.bedX - 4, y: P.bedY - 4, z: P.bedZ };
  const xyz = transformVerts(pt.mesh.vert, pt.mesh.numProp, pt.print);
  const fit = fitAngle(hull2D(xyz), bed.x, bed.y);
  pt.aids = [];
  if (fit.ok) {
    const big = Math.max(fit.w, fit.h) > 0.7 * Math.min(bed.x, bed.y);
    if (fit.mode === 'diagonal' || big) {
      const ears = earsFor(D, xyz);
      if (ears) pt.aids.push({ name: 'Orejas anti‑warping', ...meshOf(ears) });
    }
    return;
  }
  // La envolvente convexa 3D (decenas de vértices) basta para medir
  // extensiones al inclinar: búsqueda ~100× más rápida que con toda la malla.
  const pts = [];
  for (let i = 0; i < xyz.length; i += 3) pts.push([xyz[i], xyz[i + 1], xyz[i + 2]]);
  const hm = M().hull(pts).getMesh();
  const hv = new Float32Array(hm.vertProperties.length / hm.numProp * 3);
  for (let i = 0, j = 0; i < hm.vertProperties.length; i += hm.numProp, j += 3) {
    hv[j] = hm.vertProperties[i]; hv[j + 1] = hm.vertProperties[i + 1]; hv[j + 2] = hm.vertProperties[i + 2];
  }
  const tilt = tiltSolve(hv, bed);
  if (!tilt.ok) return;
  const R = tilt.axis === 'X' ? rotX((tilt.alpha * Math.PI) / 180) : rotY((tilt.alpha * Math.PI) / 180);
  const printed = solidNative().transform(pt.print);
  const tilted = printed.transform(R);
  const zmin = tilted.boundingBox().min[2];
  const tiltM = mul(T(0, 0, -zmin), R);
  pt.print = mul(tiltM, pt.print);
  pt.tilt = tilt;
  const cr = cradleFor(D, printed, tiltM);
  if (cr) pt.aids.push({ name: `Cuna de soporte (${tilt.alpha}° sobre ${tilt.axis})`, ...meshOf(cr) });
  const ears = earsFor(D, transformVerts(pt.mesh.vert, pt.mesh.numProp, pt.print));
  if (ears) pt.aids.push({ name: 'Orejas anti‑warping', ...meshOf(ears) });
}

function meshOf(man) {
  const m = man.getMesh();
  return { mesh: { numProp: m.numProp, vert: new Float32Array(m.vertProperties), tri: new Uint32Array(m.triVerts) } };
}

/* ================================================================ */
/*  Construcción completa                                           */
/* ================================================================ */

/**
 * @param {object} P   parámetros de usuario
 * @param {object} svg datos de logo preprocesados (o null), en el marco interno
 * @param {object} opt { normals: boolean }
 */
export function build(P, svg, opt = {}) {
  if (!ready) throw new Error('Motor no inicializado');
  const t0 = performance.now();
  const D = derive(P);
  const parts = [];
  const normals = opt.normals !== false;
  const report = [];
  try {
    const H = hinges(D);
    const L = latches(D);
    const z0 = D.z0;

    // Base (reutilizada si solo cambian parámetros de la tapa).
    const key = baseKey(P, normals);
    let bp;
    if (baseCache && baseCache.key === key) {
      bp = clonePart(baseCache.part);
      report.push(...baseCache.report);
    } else {
      const rep = [];
      const base = buildBase(D, H, L, rep);
      report.push(...rep);
      bp = part('base', 'Base', base, {
        print: T(0, 0, z0), instances: [T(0, 0, z0)], qty: 1, material: 'PETG / PLA / ASA',
      }, normals);
      baseCache = { key, part: clonePart(bp), report: rep };
    }
    addAids(D, P, bp, () => buildBase(D, H, L, []));
    parts.push(bp);

    const { lid, warn } = buildLid(D, P, H, L, svg, report);
    D.warn.push(...warn);
    const extra = D.stack ? D.hs : D.relief === 'emboss' && (D.pattern !== 'smooth' || svg) ? D.pd : 0;
    const lp = part('lid', 'Tapa', lid, {
      print: lidFlip(D, extra), instances: [T(0, 0, z0)], qty: 1, material: 'PETG / PLA / ASA',
    }, normals);
    addAids(D, P, lp, () => lid);
    parts.push(lp);

    // Cierre: perfil acostado (X → Z de impresión).
    const lay = [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, D.latchW / 2, 1];
    parts.push(part('latch', 'Cierre', L.latch, {
      print: lay, instances: D.latch.xs.map((x) => T(x, 0, z0)),
      qty: D.latch.n, material: 'PETG (flexible) / PLA',
    }, normals));

    // Junta: si el anillo no cabe en la cama se divide en tramos rectos
    // (cortes en los lados largos, donde la ranura es recta). El TPU se
    // asienta a presión en la ranura y los tramos quedan a tope.
    const g = gasket(D);
    if (g) {
      const bx = P.bedX - 8, by = P.bedY - 8;
      const gL = D.Lband, gW = D.Wband;
      const fits = (a, b) => (a <= bx && b <= by) || (a <= by && b <= bx) || (a + b) / Math.SQRT2 <= Math.min(bx, by);
      let n = 1;
      while (!fits(gL / n, gW) && n < 6) n++;
      const zg = z0 + D.Hb - D.gd;
      if (n === 1) {
        parts.push(part('gasket', 'Junta', g, {
          print: I4(), instances: [T(0, 0, zg)], qty: 1, material: 'TPU 95A',
        }, normals));
      } else {
        const L0 = D.Li / 2 + D.F;
        for (let k = 0; k < n; k++) {
          const xa = k === 0 ? -L0 - 5 : -D.Li / 2 + D.ri + ((D.Li - 2 * D.ri) * k) / n;
          const xb = k === n - 1 ? L0 + 5 : -D.Li / 2 + D.ri + ((D.Li - 2 * D.ri) * (k + 1)) / n;
          const piece = g.intersect(M().cube([xb - xa, gW + 20, 10]).translate([xa, -gW / 2 - 10, -1]));
          const cx = (Math.max(xa, -L0) + Math.min(xb, L0)) / 2;
          parts.push(part('gasket', `Junta (tramo ${k + 1}/${n})`, piece.translate([-cx, 0, 0]), {
            print: I4(), instances: [T(cx, 0, zg)], qty: 1, material: 'TPU 95A', key: `gasket${k}`,
          }, normals));
        }
        D.warn.push(`La junta no cabe entera en la cama: se divide en ${n} tramos rectos.`);
      }
    }

    // Pasadores: impresos o filamento + tapones, por separado para bisagra y cierre.
    const caps = [];
    D.filament = {};
    const axisZ = (d) => d / 2 - 0.12 * d;
    if (D.pinMode === 'printed') {
      const hp = printedPin(D, D.hinge.len, D.pinD);
      parts.push(part('hingePin', 'Pasador bisagra', hp.solid, {
        print: I4(),
        instances: D.hinge.xs.map((xc) => T(xc - D.hinge.len / 2, D.ya, D.za + z0 - axisZ(D.pinD))),
        qty: D.hinge.n, material: 'PETG / PLA (acostado)', length: hp.length,
      }, normals));
    } else {
      for (const xc of D.hinge.xs) caps.push({ a: xc - D.hinge.len / 2, b: xc + D.hinge.len / 2, y: D.ya, z: D.za });
      D.filament.hinge = filamentLength(D.hinge.len); D.filament.hingeQty = D.hinge.n;
    }
    if (D.latchPinMode === 'printed') {
      const lpn = printedPin(D, D.latch.span, D.latchPinD);
      parts.push(part('latchPin', 'Pasador cierre', lpn.solid, {
        print: I4(),
        instances: D.latch.xs.map((xc) => T(xc - D.latch.span / 2, D.yp, D.zp + z0 - axisZ(D.latchPinD))),
        qty: D.latch.n, material: 'PETG / PLA (acostado)', length: lpn.length,
      }, normals));
    } else {
      for (const xc of D.latch.xs) caps.push({ a: xc - D.latch.span / 2, b: xc + D.latch.span / 2, y: D.yp, z: D.zp });
      D.filament.latch = filamentLength(D.latch.span); D.filament.latchQty = D.latch.n;
    }
    if (caps.length) {
      const inst = [];
      for (const e of caps) {
        inst.push(mul(T(e.a - 2.6, e.y, e.z + z0), ZX));
        inst.push(mul(T(e.b + 2.6, e.y, e.z + z0), mul(ROTZ180, ZX)));
      }
      parts.push(part('cap', 'Tapón de pasador', filamentCap(D), {
        print: I4(), instances: inst, qty: inst.length, material: 'PLA / PETG',
      }, normals));
    }

    for (const p of parts) if (p.status !== 'NoError') D.warn.push(`${p.name}: malla con error (${p.status}).`);
    D.hullLine = report;

    return {
      ok: true,
      D: JSON.parse(JSON.stringify(D)),
      parts,
      assembly: { hinge: { y: D.ya, z: D.za + z0 }, latch: { y: D.yp, z: D.zp + z0 }, z0, rot90: D.rot90 },
      ms: Math.round(performance.now() - t0),
    };
  } finally {
    cleanup();
  }
}

function part(id, name, man, extra, normals) {
  return {
    id, key: id, name, mesh: toMesh(man, normals),
    status: String(man.status()?.value ?? man.status()),
    volume: Math.round(man.volume()),
    tris: man.numTri(),
    bbox: man.boundingBox(),
    ...extra,
  };
}

/* ---------------- Caché de la base ---------------- */
let baseCache = null;
const LID_ONLY = new Set(['pattern', 'relief', 'patternDepth', 'patternSize', 'patternRib',
  'patternMargin', 'stripeAngle', 'patternSeed', 'svgSize', 'svgRotate', 'svgOffsetX', 'svgOffsetY',
  'top', 'lidDepth', 'lidMin', 'bedPreset', 'bedX', 'bedY', 'bedZ', 'printAids']);
function baseKey(P, normals) {
  const o = {};
  for (const k of Object.keys(P).sort()) if (!LID_ONLY.has(k)) o[k] = P[k];
  return JSON.stringify(o) + normals;
}
function clonePart(p) {
  return { ...p, mesh: { ...p.mesh, vert: p.mesh.vert.slice(), tri: p.mesh.tri.slice() } };
}

/** Para pruebas: acceso a la geometría cruda sin liberar memoria. */
export const _internal = { derive, hinges, latches, buildBase, buildLid, knuckleSpans, M, cleanup, criticalLayers };
