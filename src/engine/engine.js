/**
 * engine.js — Orquestador: de parámetros a piezas listas para ver e imprimir.
 *
 * Convenciones de coordenadas
 *   - "Mundo": caja cerrada, interior centrado en X/Y, fondo del CUERPO de la
 *     base en z = 0 (los pies Gridfinity, si existen, quedan en z < 0 y la
 *     instancia los sube con z0). Frente (cierres) = −Y, trasera (bisagras) = +Y.
 *   - Cada pieza devuelve:
 *       mesh       → malla en su marco nativo
 *       print      → matriz 4×4 (columna mayor) nativo → orientación de impresión
 *       instances  → matrices nativo → mundo (una por copia en el ensamblaje)
 */
import { installGC, cleanup, prism, frustum, unionAll, toMesh, M } from './geo.js';
import { derive } from './params.js';
import { rrOffset, grooveCut, tongues, gasket } from './seal.js';
import { hinges, knuckleSpans } from './hinge.js';
import { latches } from './latch.js';
import { printedPin, filamentCap, filamentLength } from './pins.js';
import { gridfinityFeet } from './gridfinity.js';
import { lidRelief } from './pattern.js';

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

/* ---------------------------------------------------------------- */
/*  Base                                                            */
/* ---------------------------------------------------------------- */
function buildBase(D, H, L) {
  const rr = (d) => rrOffset(D, d);
  const { t, Hb, F, bo, fc, floor } = D;

  // Cuerpo exterior con chaflán anti "pata de elefante" de 0.5 mm
  // (omitido con Gridfinity: los pies ya tienen su propio chaflán).
  const outer = D.gf
    ? prism(rr(t), 0, Hb)
    : unionAll([frustum(rr(t - 0.5), 0, rr(t), 0.5), prism(rr(t), 0.5, Hb)]);

  // Banda perimetral con chaflán inferior a 45° (imprimible sin soporte).
  const zb = Hb - D.bandH;
  const zc = Math.max(0, zb - bo);
  const band = unionAll([prism(rr(F), zb, Hb), frustum(rr(F - (zb - zc)), zc, rr(F), zb)]);

  // Cavidad con chaflán interior de 45° suelo/pared (anti hull‑line):
  // el área de cada capa cambia de forma gradual en vez de pasar de golpe de
  // "fondo macizo" (capa lenta) a "solo paredes" (capa rápida).
  const cavity = unionAll([
    prism(rr(0), floor + fc, Hb + 1),
    fc > 0 ? frustum(rr(-fc), floor, rr(0), floor + fc) : null,
  ]);

  let body = unionAll([outer, band]).subtract(cavity);
  const sh = shadowCut(D, floor + fc, 0.6, zc - 0.5);
  if (sh) body = body.subtract(sh);
  body = unionAll([body, H.base, L.lugs]);
  for (const g of grooveCut(D)) body = body.subtract(g);
  body = body.subtract(H.baseHoles).subtract(L.lugHoles);
  if (D.gf) body = body.add(gridfinityFeet(D));
  return body;
}

/**
 * Ranura de sombra en V (90°) a la altura de la transición fondo → paredes.
 * Una línea de contracción que cae dentro de una arista intencionada deja de
 * ser visible y, además, la ranura obliga al slicer a cambiar el perímetro
 * exterior en esa capa, repartiendo la contracción.
 */
function shadowCut(D, zt, zMin, zMax) {
  const v = D.shadowV;
  if (!D.shadow || D.fc <= 0) return null;
  if (zt - v < zMin || zt + v > zMax) return null;
  const rr = (d) => rrOffset(D, d);
  const vee = unionAll([frustum(rr(D.t), zt - v, rr(D.t - v), zt), frustum(rr(D.t - v), zt, rr(D.t), zt + v)]);
  return prism(rr(D.t + 1), zt - v, zt + v).subtract(vee);
}

/* ---------------------------------------------------------------- */
/*  Tapa (coordenadas de mundo; se voltea para imprimir)            */
/* ---------------------------------------------------------------- */
function buildLid(D, P, H, L, svg) {
  const rr = (d) => rrOffset(D, d);
  const { t, Hb, Hl, F, bo, fc } = D;
  const zB = Hb, zT = Hb + Hl;
  const outer = unionAll([prism(rr(t), zB, zT - 0.5), frustum(rr(t), zT - 0.5, rr(t - 0.5), zT)]);
  const zbt = zB + D.bandHl;
  const zc = Math.min(zT - 0.5, zbt + bo);
  const band = unionAll([prism(rr(F), zB, zbt), frustum(rr(F), zbt, rr(F - (zc - zbt)), zc)]);
  const zi = zT - D.topT;
  const cavity = unionAll([
    prism(rr(0), zB - 1, zi - fc),
    fc > 0 ? frustum(rr(0), zi - fc, rr(-fc), zi) : null,
  ]);
  let lid = unionAll([outer, band]).subtract(cavity);
  const sh = shadowCut(D, zi - fc, zc + 0.5, zT - 0.6);
  if (sh) lid = lid.subtract(sh);
  lid = unionAll([lid, H.lid, L.keepers, ...tongues(D)]);
  lid = lid.subtract(H.lidHoles);
  const rel = lidRelief(D, P, svg);
  if (rel.cut) lid = lid.subtract(rel.cut);
  if (rel.add) lid = lid.add(rel.add);
  return { lid, warn: rel.warn };
}

/* ---------------------------------------------------------------- */
/*  Construcción completa                                           */
/* ---------------------------------------------------------------- */

/**
 * @param {object} P   parámetros de usuario
 * @param {object} svg datos de logo preprocesados (o null)
 * @param {object} opt { normals: boolean }
 */
export function build(P, svg, opt = {}) {
  if (!ready) throw new Error('Motor no inicializado');
  const t0 = performance.now();
  const D = derive(P);
  const parts = [];
  const normals = opt.normals !== false;
  try {
    const H = hinges(D);
    const L = latches(D);
    const z0 = D.z0;

    // La base no depende de la decoración de la tapa ni de la impresora: se
    // reutiliza mientras solo cambian esos parámetros (edición en vivo del
    // patrón o del SVG ≈ 2× más rápida).
    const key = baseKey(P, normals);
    if (baseCache && baseCache.key === key) {
      parts.push(clonePart(baseCache.part));
    } else {
      const base = buildBase(D, H, L);
      const bp = part('base', 'Base', base, D, {
        print: T(0, 0, z0), instances: [T(0, 0, z0)], qty: 1, material: 'PETG / PLA / ASA',
      }, normals);
      baseCache = { key, part: clonePart(bp) };
      parts.push(bp);
    }

    const { lid, warn } = buildLid(D, P, H, L, svg);
    D.warn.push(...warn);
    const zMax = D.Hb + D.Hl + (D.relief === 'emboss' && (D.pattern !== 'smooth' || svg) ? D.pd : 0);
    const flip = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, zMax, 1];
    parts.push(part('lid', 'Tapa', lid, D, {
      print: flip, instances: [T(0, 0, z0)], qty: 1, material: 'PETG / PLA / ASA',
    }, normals));

    // Cierre: perfil acostado (X → Z de impresión).
    const lay = [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, D.latchW / 2, 1];
    parts.push(part('latch', 'Cierre', L.latch, D, {
      print: lay, instances: D.latch.xs.map((x) => T(x, 0, z0)),
      qty: D.latch.n, material: 'PETG (flexible) / PLA',
    }, normals));

    const g = gasket(D);
    if (g) parts.push(part('gasket', 'Junta', g, D, {
      print: I4(), instances: [T(0, 0, z0 + D.Hb - D.gd)], qty: 1, material: 'TPU 95A',
    }, normals));

    // Pasadores.
    const rp = D.pinD / 2;
    const pinAxisZ = rp - 0.12 * D.pinD;      // altura del eje en el pin impreso
    if (D.pinMode === 'printed') {
      const hp = printedPin(D, D.hinge.len);
      parts.push(part('hingePin', 'Pasador bisagra', hp.solid, D, {
        print: I4(),
        instances: D.hinge.xs.map((xc) => T(xc - D.hinge.len / 2, D.ya, D.za + z0 - pinAxisZ)),
        qty: D.hinge.n, material: 'PETG / PLA (acostado)', length: hp.length,
      }, normals));
      const lp = printedPin(D, D.latch.span);
      parts.push(part('latchPin', 'Pasador cierre', lp.solid, D, {
        print: I4(),
        instances: D.latch.xs.map((xc) => T(xc - D.latch.span / 2, D.yp, D.zp + z0 - pinAxisZ)),
        qty: D.latch.n, material: 'PETG / PLA (acostado)', length: lp.length,
      }, normals));
    } else {
      const cap = filamentCap(D);
      const inst = [];
      const ends = [
        ...D.hinge.xs.map((xc) => ({ a: xc - D.hinge.len / 2, b: xc + D.hinge.len / 2, y: D.ya, z: D.za })),
        ...D.latch.xs.map((xc) => ({ a: xc - D.latch.span / 2, b: xc + D.latch.span / 2, y: D.yp, z: D.zp })),
      ];
      for (const e of ends) {
        inst.push(mul(T(e.a - 2.6, e.y, e.z + z0), ZX));
        inst.push(mul(T(e.b + 2.6, e.y, e.z + z0), mul(ROTZ180, ZX)));
      }
      parts.push(part('cap', 'Tapón de pasador', cap, D, {
        print: I4(), instances: inst, qty: inst.length, material: 'PLA / PETG',
      }, normals));
      D.filament = {
        hinge: filamentLength(D.hinge.len), hingeQty: D.hinge.n,
        latch: filamentLength(D.latch.span), latchQty: D.latch.n,
      };
    }

    // Comprobaciones de integridad.
    for (const p of parts) if (p.status !== 'NoError') D.warn.push(`${p.name}: malla con error (${p.status}).`);

    return {
      ok: true,
      D: serializableD(D),
      parts: parts.map(({ _m, ...rest }) => rest),
      assembly: {
        hinge: { y: D.ya, z: D.za + z0 },
        latch: { y: D.yp, z: D.zp + z0 },
        z0,
      },
      ms: Math.round(performance.now() - t0),
    };
  } finally {
    cleanup();
  }
}

function part(id, name, man, D, extra, normals) {
  const mesh = toMesh(man, normals);
  const bb = man.boundingBox();
  return {
    id, name, mesh,
    status: String(man.status()?.value ?? man.status()),
    volume: Math.round(man.volume()),
    tris: man.numTri(),
    bbox: bb,
    ...extra,
  };
}

/* ---------------- Caché de la base ---------------- */
let baseCache = null;
const LID_ONLY = new Set(['pattern', 'relief', 'patternDepth', 'patternSize', 'patternRib',
  'patternMargin', 'stripeAngle', 'svgSize', 'svgRotate', 'svgOffsetX', 'svgOffsetY', 'top',
  'bedPreset', 'bedX', 'bedY', 'bedZ']);
function baseKey(P, normals) {
  const o = {};
  for (const k of Object.keys(P).sort()) if (!LID_ONLY.has(k)) o[k] = P[k];
  return JSON.stringify(o) + normals;
}
function clonePart(p) {
  return { ...p, mesh: { ...p.mesh, vert: p.mesh.vert.slice(), tri: p.mesh.tri.slice() } };
}

function serializableD(D) {
  return JSON.parse(JSON.stringify(D));
}

/** Para pruebas: acceso a la geometría cruda sin liberar memoria. */
export const _internal = { derive, hinges, latches, buildBase, buildLid, knuckleSpans, M, cleanup };
