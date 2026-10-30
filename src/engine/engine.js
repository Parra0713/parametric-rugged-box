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
import { installGC, cleanup, prism, frustum, unionAll, toMesh, M, CS, roundRect, yzExtrude, teardrop } from './geo.js';
import { derive, pinHeadR, ecoParams } from './params.js';
import { rrOffset, grooveCut, tongues, gasket, stackLines } from './seal.js';
import { hinges, knuckleSpans } from './hinge.js';
import { latches } from './latch.js';
import { printedPin, filamentCap, filamentLength } from './pins.js';
import { gridfinityFeet } from './gridfinity.js';
import { lidRelief, patternArea } from './pattern.js';
import { baseInsert, lidInsert } from './insert.js';
import { orgLidGeometry, orgPanel, orgCavity } from './organizer.js';
import { transformVerts, hull2D, fitAngle, tiltChoose, rotatedExtent } from '../bedfit.js';
import { fitsFlat } from '../optimizer.js';
import { contactCut, supportFins, wedgeVolume, rotAxis, invRigid, overhangRegions, overhangSupports } from './tilt.js';

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
const critMemo = new Map();          // firma del sólido → alturas críticas
export function criticalLayers(man, lh, zMax) {
  // Hasta 400 cortes por pieza: es lo más caro de la base y la tapa después
  // de los booleanos. El núcleo no cambia con casi ningún parámetro de la
  // tapa (patrón, logo, ayudas…), así que se memoriza por la firma del sólido.
  const bb = man.boundingBox();
  const key = [lh, zMax, man.numTri(), Math.round(man.volume() * 1000), ...bb.min, ...bb.max].map((v) => Math.round(v * 1e4)).join(',');
  const hit = critMemo.get(key);
  if (hit) return hit.map((c) => ({ ...c }));
  const res = criticalLayersRaw(man, lh, zMax);
  critMemo.set(key, res);
  if (critMemo.size > 16) critMemo.delete(critMemo.keys().next().value);
  return res.map((c) => ({ ...c }));
}

function criticalLayersRaw(man, lh, zMax) {
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

/**
 * Nervios de pared del modo ahorro nervado (D.wallRibs): huella 2D de las
 * franjas, solo por fuera de la pared y dentro de la envolvente de la banda.
 */
function wallRibZone(D) {
  const R = D.wallRibs, big = 400;
  const strips = [
    ...R.long.map(([x, s]) => CS().square([R.w, big], false).translate([x - R.w / 2, s > 0 ? 0 : -big])),
    ...R.short.map(([y, s]) => CS().square([big, R.w], false).translate([s > 0 ? 0 : -big, y - R.w / 2])),
  ];
  return CS().union(strips).subtract(rrOffset(D, D.t - 0.3)).intersect(rrOffset(D, D.F + 0.01));
}

/** Tubos libres a lo largo de los ejes de pasadores y tapones (se restan a los nervios). */
function wallRibAxes(D) {
  const R = D.wallRibs;
  return unionAll(R.axes.map(([y, z]) => yzExtrude(CS().circle(R.axisR, 24).translate([y, z]), -D.Lo, D.Lo)));
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
    const m = D.cham > 0 ? 0 : Math.min((D.Li - D.gfNx * 42) / 2, (D.Wi - D.gfNy * 42) / 2) + 0.25;
    fc = Math.max(0, Math.min(fc, m - 0.1));
  }
  const ft = D.floorTop;

  const chB = D.stack ? D.chB : 0.5;
  const outer = D.gfFeet
    ? prism(rr(t), 0, Hb)
    : unionAll([frustum(rr(t - chB), 0, rr(t), chB), prism(rr(t), chB, Hb)]);
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
  const crit = D.draft ? [] : criticalLayers(core, D.lh, Hb);
  // Borde inferior de la V: por encima del chaflán de la base + 1 capa
  // (apilable: del faldón). Con fondos finos (modo ahorro: 1 mm) la línea cae
  // a ~1 mm de la cama: la V se sube lo justo para no tocar el chaflán,
  // siempre que la línea siga dentro de ella.
  const v = D.shadowV;
  const zLo = D.stack ? D.hf + 1 : chB + D.lh;
  const zHi = zc - 1.2;
  const grooves = [];
  for (const c of crit) {
    const z = c.z;
    const zg = Math.max(z, zLo + v);
    const ok = D.shadow && zg - z <= 0.8 * v && zg + v <= zHi;
    report.push({ part: 'Base', z, drop: c.drop, masked: ok ? 'ranura de sombra' : D.stack && z < zLo ? 'chaflán de apilado' : z >= zc - 1.2 ? 'banda' : 'no' });
    if (ok && grooves.length < 2) grooves.push(r2(zg));
  }
  for (const z of grooves) core = core.subtract(vGroove(D, t, z));

  // Frente 4: nervios de esquina (rompen la continuidad visual de cualquier
  // marca horizontal y protegen las esquinas en caídas).
  if (D.ribs) {
    let bump = unionAll([
      D.gfFeet ? prism(rr(F), 0, chB) : frustum(rr(F - chB), 0, rr(F), chB),
      prism(rr(F), chB, Hb),
    ]).intersect(prism(cornerZones(D).subtract(rr(t - 0.3)), -1, Hb + 1));   // solo por fuera de la pared
    for (const z of grooves) bump = bump.subtract(vGroove(D, F, z));
    core = core.add(bump);
  }

  // Modo ahorro nervado: nervios verticales hasta la banda (misma envolvente).
  if (D.wallRibs) {
    let rib = unionAll([
      D.gfFeet ? prism(rr(F), 0, chB) : frustum(rr(F - chB), 0, rr(F), chB),
      prism(rr(F), chB, Hb),
    ]).intersect(prism(wallRibZone(D), -1, Hb + 1)).subtract(wallRibAxes(D));
    for (const z of grooves) rib = rib.subtract(vGroove(D, F, z));
    core = core.add(rib);
  }

  // Canal de montaje del pasador del cierre a través del nervio de esquina
  // (solo si ningún lado del eje tiene recorrido libre): teardrop hacia
  // arriba, imprimible sin soporte.
  if (D.ribs && D.latch.grooves?.length) {
    const r = pinHeadR(D.latchPinD) + 0.3;
    const ribZone = prism(cornerZones(D).subtract(rrOffset(D, D.t - 0.3)), -1, Hb + 1);
    for (const g of D.latch.grooves) {
      const x0 = g.side > 0 ? g.x : -D.Lo, x1 = g.side > 0 ? D.Lo : g.x;
      core = core.subtract(yzExtrude(teardrop(D.yp, D.zp, r, true, D.seg), x0, x1).intersect(ribZone));
    }
  }

  let body = unionAll([core, H.base, L.lugs]);
  for (const g of grooveCut(D)) body = body.subtract(g);
  body = body.subtract(L.pockets).subtract(H.baseHoles).subtract(L.lugHoles);

  // Apilado: la pared baja recta hasta la cama (la mecánica no se toca). Por
  // debajo: faldón con cara interior a 45° (paralela a la cara exterior del
  // marco de la tapa de abajo + holgura) y canal hasta hf donde entra el
  // marco; dentro, el pie con ranuras para los nervios.
  if (D.stack) {
    const a = t - D.db + D.sclr;                 // cara interior del faldón en z = 0
    const channel = frustum(rr(a), -0.01, rr(a - D.hf - 0.01), D.hf)
      .subtract(prism(rr(D.sFoot), -1, D.hf + 1));
    body = body.subtract(channel);
    const slots = stackLines(D, D.gwS, 400);
    if (slots) body = body.subtract(prism(slots.intersect(rr(D.sFoot + 1)), -1, D.hf));
  }
  if (D.gfFeet) body = body.add(gridfinityFeet(D));
  return body;
}

/** Huecos de la placa base Gridfinity (perfil estándar, abiertos hasta el fondo). */
function gridfinitySockets(D) {
  const z = D.floorTop - D.gbH;                 // sobre el pie de apilado si lo hay
  const a = roundRect(36.3, 36.3, 1.15, D.seg);
  const b = roundRect(37.7, 37.7, 1.85, D.seg);
  const c = roundRect(42, 42, 4, D.seg);
  const cell = unionAll([
    frustum(a, z, b, z + 0.7),
    prism(b, z + 0.7, z + 2.5),
    frustum(b, z + 2.5, c, z + D.gbH),
    prism(c, z + D.gbH - 0.01, z + D.gbH + 0.4),
  ]);
  return unionAll(D.gfCells.map(([x, y]) => cell.translate([x, y, 0])));
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
  const ce = D.stack ? D.db : 0.5;              // apilable: bisel de 45° que sube al marco
  const outer = unionAll([prism(rr(t), zB, zT - ce), frustum(rr(t), zT - ce, rr(t - ce), zT)]);
  const zbt = zB + D.bandHl;
  const zc = Math.min(zT - 0.5, zbt + bo);
  const band = unionAll([prism(rr(F), zB, zbt), frustum(rr(F), zbt, rr(F - (zc - zbt)), zc)]);
  const zi = zT - D.topT;
  const cavity = D.Dl > 0.05 ? unionAll([
    prism(rr(0), zB - 1, zi - fc),
    fc > 0 ? frustum(rr(0), zi - fc, rr(-fc), zi) : null,
  ]) : null;
  const shell = unionAll([outer, band]);
  let core = cavity ? shell.subtract(cavity) : shell;

  // Análisis en orientación de impresión (boca abajo).
  const flip = lidFlip(D, 0);
  const crit = D.draft ? [] : criticalLayers(core.transform(flip), D.lh, Hl);
  const grooves = [];
  // Igual que en la base: la V no toca el bisel del borde superior (+1 capa)
  // y, con techos finos, se desplaza lo justo hacia dentro de la pieza
  // siempre que la línea quede dentro de ella. Apilable: el bisel de 45° del
  // marco (db) ya rompe la línea si cae ahí.
  const v = D.shadowV, zLoP = ce + D.lh;
  for (const c of crit) {
    const zp = Math.max(c.z, zLoP + v);                      // en impresión (desde la cara superior)
    const zw = r2(zT - zp);                                  // altura en mundo
    const ok = D.shadow && zp - c.z <= 0.8 * v && zw - v >= zc + 1.0;
    report.push({ part: 'Tapa', z: c.z, drop: c.drop,
      masked: ok ? 'ranura de sombra' : D.stack && c.z < ce ? 'chaflán de apilado' : zT - c.z < zc + 1 ? 'banda' : 'no' });
    if (ok && grooves.length < 2) grooves.push(zw);
  }
  for (const z of grooves) core = core.subtract(vGroove(D, t, z));

  // Remate superior de nervios de esquina y de pared: 45° hasta la cara
  // superior. Apilable: la tapa apoya en el marco de apilado y su cara
  // superior (rr(t − ce)) empieza a `hs` de la cama; el nervio debe bajar en
  // chaflán hasta ese contorno o queda en ménsula a 90°.
  const cr = D.stack ? F - (t - ce) : 0.5;
  let ribBump = null;
  if (D.ribs) {
    let bump = unionAll([prism(rr(F), zB, zT - cr), frustum(rr(F), zT - cr, rr(F - cr), zT)])
      .intersect(prism(cornerZones(D).subtract(rr(D.stack ? Math.max(0.05, t - ce - 0.3) : t - 0.3)), zB - 1, zT + 1));
    for (const z of grooves) bump = bump.subtract(vGroove(D, F, z));
    core = core.add(bump);
    ribBump = bump;
  }

  let wallRib = null;
  if (D.wallRibs) {
    wallRib = unionAll([prism(rr(F), zB, zT - cr), frustum(rr(F), zT - cr, rr(F - cr), zT)])
      .intersect(prism(wallRibZone(D), zB - 1, zT + 1)).subtract(wallRibAxes(D));
    for (const z of grooves) wallRib = wallRib.subtract(vGroove(D, F, z));
    core = core.add(wallRib);
  }

  // Organizador: la tapa se vacía con su propio hueco (franja de las tapas
  // interiores + celdas) en una sola resta. El núcleo "normal" de arriba solo
  // sirve para el análisis de capas (ranuras de sombra), que no cambia.
  if (D.org) {
    core = shell.subtract(orgCavity(D, zB));
    for (const z of grooves) core = core.subtract(vGroove(D, t, z));
    if (D.ribs) core = core.add(ribBump);
    if (wallRib) core = core.add(wallRib);
  }
  let lid = unionAll([core, H.lid, L.lidCheeks, L.keepers, ...tongues(D)]);
  lid = lid.subtract(H.lidHoles);
  if (D.org) {
    // Grapas y canales del eje de las tapas interiores.
    const og = orgLidGeometry(D, { mechOnly: true });
    if (og.add) lid = lid.add(og.add);
    if (og.cut) lid = lid.subtract(og.cut);
  }
  // Patrón/logo de la tapa (solo depende de su contorno y de sus ajustes):
  // se reutiliza entre reconstrucciones si no cambian.
  const rk = memoKey('rel', D.Li, D.Wi, D.ri, D.cham, D.t, D.seg, D.Hb, D.Hl, D.pd, D.stack, D.maxBridge, D.pattern, D.relief,
    D.stack ? [D.db, D.hs, D.fwT, D.frameIn, D.rw, D.stackRibs] : null,
    ['patternSize', 'patternRib', 'patternMargin', 'stripeAngle', 'patternSeed'].map((k) => P[k]), svg);
  const rm = memoSolid(rk, () => {
    const r = lidRelief(D, P, svg);
    const solid = r.cut || r.add;
    return solid ? { solid, kind: r.cut ? 'cut' : 'add', warn: r.warn } : { solid: M().cube([0, 0, 0]), kind: 'none', warn: r.warn };
  });
  const rel = { cut: rm.kind === 'cut' ? rm.solid : null, add: rm.kind === 'add' ? rm.solid : null, warn: rm.warn };
  if (rel.cut) lid = lid.subtract(rel.cut);
  if (rel.add) lid = lid.add(rel.add);
  // Relieve: la tapa se imprime boca abajo apoyada en el relieve. Todo lo que
  // llega a la cara superior fuera del área del patrón (margen, bisel, nervios
  // de esquina y de pared) sube también `pd`: si no, el contorno entero queda
  // en ménsula a 90° a `pd` de la cama.
  if (rel.add && !D.stack) {
    const edge = core.slice(zT - 0.02).subtract(patternArea(D, P));
    if (!edge.isEmpty()) lid = lid.add(prism(edge, zT - 0.01, zT + D.pd));
  }
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
  return CS().union(discs);                       // 2D: se recorta a la cama antes de extruir
}

/**
 * Recorta una ayuda (orejas) al área real de la cama, suponiendo la pieza
 * centrada en la cama con el giro `angle` (así la coloca la interfaz).
 */
function clipToBed(cs2d, hull, angle, bedX, bedY) {
  const e = rotatedExtent(hull, angle);
  const cx = e.x0 + e.w / 2, cy = e.y0 + e.h / 2;
  const rect = CS().square([bedX - 2, bedY - 2], true).translate([cx, cy]).rotate(-angle);
  return cs2d.intersect(rect);
}

/**
 * Decide las ayudas de impresión para una pieza grande (base o tapa):
 *  - Cabe plana: si va en diagonal o casi llena la cama → orejas en las
 *    esquinas, recortadas para no salirse de la cama.
 *  - No cabe plana: inclinación (45° preferente, eje que deja el apoyo en los
 *    extremos CORTOS, sin mecánica) + bisel de contacto SIMÉTRICO en ambos
 *    extremos, integrado en la pieza + aletas de soporte configurables.
 * Modifica `pt` (malla, `print`, `place`) y añade `pt.aids`.
 */
/**
 * @param G geometría del contorno de la pieza para el bisel:
 *   { hx, hy } semiejes de las caras exteriores (contacto con la cama al
 *   inclinar), wall espesor de pared (el bisel deja ≥ 1 pared), mech true si
 *   la pieza lleva bisagras/cierres que el bisel no debe tocar.
 */
/* ---------------- Caché de ayudas de impresión ---------------- */
// Inclinar, biselar, aletas y soportes de voladizos cuesta segundos en cajas
// grandes. El resultado solo depende de la malla de la pieza y de unos pocos
// parámetros, así que se memoriza por la huella de la malla: cambiar el
// patrón de la tapa ya no recalcula los soportes de la base, y volver a un
// valor anterior es instantáneo.
const aidsMemo = new Map();
const AID_KEYS = ['printAids', 'bedX', 'bedY', 'bedZ', 'finSpacing', 'finReach', 'toothPitch', 'finGap',
  'overhangSupports', 'overhangAngle', 'supportPitch'];

/** Huella FNV‑1a de una malla (posiciones/normales y triángulos). */
export function meshHash(mesh) {
  let h = 0x811c9dc5;
  const mix = (a) => { for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 0x01000193); } };
  mix(new Uint32Array(mesh.vert.buffer, mesh.vert.byteOffset, mesh.vert.length));
  mix(mesh.tri);
  return (h >>> 0).toString(36) + ':' + mesh.vert.length + ':' + mesh.tri.length;
}

const cloneMesh = (m) => ({ ...m, vert: m.vert.slice(), tri: m.tri.slice() });

/* ---------------- Caché de sólidos entre reconstrucciones ---------------- */
// Piezas que solo dependen de unas pocas cotas (inserto, tapas interiores):
// si no cambian, se reutiliza su malla en vez de repetir los booleanos.
// Al editar la tapa o el organizador ya no se recalcula el inserto (con un
// calco detallado, 300–400 ms) y viceversa.
const solidMemo = new Map();
function memoSolid(key, buildFn) {
  const hit = solidMemo.get(key);
  if (hit) {
    solidMemo.delete(key); solidMemo.set(key, hit);
    return { ...hit.extra, solid: M().ofMesh({ numProp: 3, vertProperties: hit.vert, triVerts: hit.tri }) };
  }
  const r = buildFn();
  const m = r.solid.getMesh();
  const vert = new Float32Array(m.numVert * 3);
  for (let i = 0, j = 0; i < m.vertProperties.length; i += m.numProp, j += 3) {
    vert[j] = m.vertProperties[i]; vert[j + 1] = m.vertProperties[i + 1]; vert[j + 2] = m.vertProperties[i + 2];
  }
  const { solid, ...extra } = r;
  const ent = { vert, tri: new Uint32Array(m.triVerts), extra: JSON.parse(JSON.stringify(extra)) };
  solidMemo.set(key, ent);
  if (solidMemo.size > 16) solidMemo.delete(solidMemo.keys().next().value);
  // Se devuelve SIEMPRE el sólido rehecho desde la malla guardada: así un
  // acierto y un fallo de la caché dan exactamente la misma triangulación
  // (y la misma huella para la caché de ayudas, y el mismo resultado en un
  // hilo que en dos).
  return { ...r, solid: M().ofMesh({ numProp: 3, vertProperties: ent.vert, triVerts: ent.tri }) };
}
const r2 = (v) => Math.round(v * 100) / 100;
const memoKey = (tag, ...v) => tag + JSON.stringify(v);

function addAids(D, P, pt, solidNative, normals, G = { hx: D.Lo / 2, hy: D.Wo / 2, wall: D.t, mech: true }) {
  if (D.draft) { pt.aids = []; pt.draft = true; return; }   // vista rápida: sin ayudas
  const key = JSON.stringify([pt.id, meshHash(pt.mesh), normals, pt.print, G, AID_KEYS.map((k) => P[k]),
    D.fc, D.fcl, D.Li, D.Wi, D.Hb, D.Hl, D.topT, D.z0, D.lw, D.lh, D.t, D.gfFeet, D.Lo, D.Wo,
    D.hinge.xs, D.hinge.len, D.latch.xs, D.latch.span]);
  const hit = aidsMemo.get(key);
  if (hit) {
    aidsMemo.delete(key); aidsMemo.set(key, hit);              // LRU
    Object.assign(pt, {
      mesh: cloneMesh(hit.mesh), volume: hit.volume, tris: hit.tris, print: hit.print.slice(),
      place: hit.place && { ...hit.place }, tilt: hit.tilt && JSON.parse(JSON.stringify(hit.tilt)),
      aids: hit.aids.map((a) => ({ ...a, mesh: cloneMesh(a.mesh) })),
    });
    for (const l of hit.log) log(D, l);
    return;
  }
  const n0 = (D.log ||= []).length;
  addAidsRaw(D, P, pt, solidNative, normals, G);
  aidsMemo.set(key, {
    mesh: cloneMesh(pt.mesh), volume: pt.volume, tris: pt.tris, print: pt.print.slice(),
    place: pt.place && { ...pt.place }, tilt: pt.tilt && JSON.parse(JSON.stringify(pt.tilt)),
    aids: pt.aids.map((a) => ({ ...a, mesh: cloneMesh(a.mesh) })), log: D.log.slice(n0),
  });
  if (aidsMemo.size > 6) aidsMemo.delete(aidsMemo.keys().next().value);
}

function addAidsRaw(D, P, pt, solidNative, normals, G) {
  pt.aids = [];
  if (P.printAids === 'off') return;
  const bed = { x: P.bedX - 4, y: P.bedY - 4, z: P.bedZ };
  const xyz = transformVerts(pt.mesh.vert, pt.mesh.numProp, pt.print);
  const hull = hull2D(xyz);
  const fit = fitAngle(hull, bed.x, bed.y);
  if (fit.ok) {
    pt.place = { angle: fit.angle };
    const big = Math.max(fit.w, fit.h) > 0.7 * Math.min(bed.x, bed.y);
    if (fit.mode === 'diagonal' || big) {
      const ears = earsFor(D, xyz);
      if (ears) {
        const clipped = clipToBed(ears, hull, fit.angle, P.bedX, P.bedY);
        if (!clipped.isEmpty()) pt.aids.push({ name: 'Orejas anti‑warping', ...meshOf(prism(clipped, 0, 2 * D.lh)) });
      }
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
  // Eje Y de impresión = apoyo en los extremos x (lados cortos, sin bisagras
  // ni cierres): permite un bisel simétrico sin tocar la mecánica.
  const tilt = tiltChoose(hv, bed, 'Y');
  if (!tilt.ok) return;
  const Rm = rotAxis(tilt.axis, tilt.alpha);
  let Q = solidNative().transform(pt.print);
  // El chaflán interior anti línea de contracción (45°) del extremo que sube
  // queda HORIZONTAL al inclinar 45° (techo en el aire). Inclinada, las capas
  // ya no son paralelas al fondo, así que ese chaflán no aporta nada: se
  // elimina en ese extremo y el rincón queda a 90° (dos caras a 45°).
  const fcI = pt.id === 'base' ? D.fc : pt.id === 'lid' ? D.fcl : 0;
  if (fcI > 0) {
    for (const sx of [-1, 1]) {
      const nz = Rm[2] * (-sx) / Math.SQRT2 + Rm[10] / Math.SQRT2;   // z de Rm·n, n = (−sx,0,1)/√2
      if (nz > -Math.cos((50 * Math.PI) / 180)) continue;
      const half = CS().square([fcI + 1, 4 * D.Wi + 100], false).translate([sx > 0 ? D.Li / 2 - fcI - 0.05 : -D.Li / 2 - 0.95, -2 * D.Wi - 50]);
      const zone = rrOffset(D, 0).intersect(half);
      const z0 = pt.id === 'base' ? D.floorTop : D.Hb + D.Hl - D.topT - fcI;
      Q = Q.subtract(prism(zone, z0 - 0.01, z0 + fcI + 0.01).translate([0, 0, D.z0 * (pt.id === 'base' ? 1 : 0)]).transform(pt.print));
      log(D, `${pt.id}: chaflán interior del extremo ${sx > 0 ? '+X' : '−X'} eliminado (sería un techo horizontal al inclinar)`);
    }
  }
  const R0 = Q.transform(Rm);
  const zmin = R0.boundingBox().min[2];
  const bq = Q.boundingBox();
  const axisLen = tilt.axis === 'X' ? bq.max[0] - bq.min[0] : bq.max[1] - bq.min[1];
  const cut = contactCut(R0, zmin, axisLen, G.wall, D.lh);
  const zc = zmin + cut.h;
  let Q2 = Q;
  let symmetric = false;
  if (cut.h > 0) {
    // Plano de corte en el marco de impresión sin inclinar: n·p ≥ zc con
    // n = Rmᵀ·(0,0,1). Su espejo respecto al plano medio de la pieza da el
    // bisel simétrico del extremo opuesto.
    const n = [Rm[2], Rm[6], Rm[10]];
    // Bisel integrado en las CUATRO aristas del contorno (x−, x+, y−, y+),
    // todas a la misma distancia de su arista: pieza simétrica y coherente.
    // s0 = posición del plano respecto a la arista de contacto de la pared.
    const zb = bq.min[2];
    const sa = Math.hypot(n[0], n[1]), ca = n[2];
    const onX = Math.abs(n[0]) >= Math.abs(n[1]);
    const Cc = onX ? [Math.sign(n[0]) * -G.hx, 0, zb] : [0, Math.sign(n[1]) * -G.hy, zb];
    const s0 = zc - (n[0] * Cc[0] + n[1] * Cc[1] + n[2] * Cc[2]);
    const sides = G.mech && D.gfFeet ? [] : [
      [[sa, 0, ca], [-G.hx, 0, zb]], [[-sa, 0, ca], [G.hx, 0, zb]],
      [[0, sa, ca], [0, -G.hy, zb]], [[0, -sa, ca], [0, G.hy, zb]],
    ];
    // Zonas mecánicas (bisagras y cierres, por fuera de la pared): el bisel
    // NUNCA las toca. Antes el bisel de las aristas largas recortaba nudillos,
    // cartabones y mejillas (piezas "incompletas o raras" en modo inclinado).
    const keep = G.mech ? mechanicsKeepOut(D, pt.print, bq) : null;
    const big = 4 * Math.max(bq.max[0] - bq.min[0], bq.max[1] - bq.min[1], bq.max[2] - bq.min[2]) + 100;
    const cube = M().cube([big, big, big], true).translate([(bq.min[0] + bq.max[0]) / 2, (bq.min[1] + bq.max[1]) / 2, (bq.min[2] + bq.max[2]) / 2]);
    for (const [ni, Ci] of sides) {
      const off = ni[0] * Ci[0] + ni[1] * Ci[1] + ni[2] * Ci[2] + s0;
      // Región que se elimina = lado negativo del plano, menos la mecánica.
      let cutter = cube.trimByPlane([-ni[0], -ni[1], -ni[2]], -off);
      if (keep) cutter = cutter.subtract(keep);
      Q2 = Q2.subtract(cutter);
    }
    if (!sides.length) Q2 = Q.trimByPlane(n, zc);
    symmetric = sides.length > 0;
    // El bisel es parte del diseño: vuelve al marco nativo (ensamblaje y STL).
    const native = Q2.transform(invRigid(pt.print));
    Object.assign(pt, { mesh: toMesh(native, normals), volume: Math.round(native.volume()), tris: native.numTri() });
  }
  const R = Q2.transform(Rm).translate([0, 0, -zc]);
  pt.print = mul(mul(T(0, 0, -zc), Rm), pt.print);
  const fins = P.printAids === 'nofins' ? null : supportFins(R, tilt.axis, D.lw, D.lh, {
    spacing: P.finSpacing, reach: P.finReach, pitch: P.toothPitch, gap: P.finGap,
  });
  pt.tilt = {
    ...tilt, cut: Math.round(cut.h * 100) / 100, contact: cut.width, symmetric,
    finVol: fins?.volume ?? 0, finCount: fins?.count ?? 0, wedgeVol: wedgeVolume(R, D.lh),
  };
  if (fins) pt.aids.push({ name: `Aletas de soporte (${fins.count} × ${tilt.alpha}° sobre ${tilt.axis})`, ...meshOf(fins.solid) });
  // Voladizos de las partes salientes (nudillos, mejillas, retenes): se
  // detectan capa a capa contando con lo que ya sostienen las aletas.
  if (P.overhangSupports !== false) {
    const t0 = performance.now();
    const regions = overhangRegions(R, fins?.solid ?? null, { angle: P.overhangAngle || 50 });
    const ov = overhangSupports(R, regions, D.lw, D.lh, { pitch: P.supportPitch || 3 });
    pt.tilt.overhangs = regions.length;
    pt.tilt.overhangArea = Math.round(regions.reduce((a, r) => a + r.area, 0));
    if (ov) {
      pt.aids.push({ name: `Soportes de voladizos (${ov.count} zonas)`, ...meshOf(ov.solid) });
      pt.tilt.ovVol = ov.volume;
      pt.tilt.ovCount = ov.count;
    }
    log(D, `${pt.id}: ${regions.length} voladizos (${pt.tilt.overhangArea} mm²), soportes ${ov?.volume ?? 0} mm³ en ${Math.round(performance.now() - t0)} ms`);
  }
}

/** Registro interno de la construcción (se muestra en la interfaz y en las pruebas). */
function log(D, msg) { (D.log ||= []).push(msg); }

/**
 * Volumen protegido del bisel: tramos X de bisagras y cierres (+2 mm), por
 * fuera de la cara interior de la pared, en el lado de cada mecanismo.
 * `print` es la matriz nativo → impresión (la tapa invierte Y).
 */
function mechanicsKeepOut(D, print, bq) {
  const sY = Math.sign(print[5]) || 1;
  const H = 4 * (bq.max[2] - bq.min[2] + 50), Wd = 200;
  const z0 = (bq.min[2] + bq.max[2]) / 2;
  const blocks = [];
  const add = (xc, half, side) => {
    const y0 = side > 0 ? D.Wi / 2 : -D.Wi / 2 - Wd;
    blocks.push(M().cube([2 * half + 4, Wd, H]).translate([xc - half - 2, y0, z0 - H / 2]));
  };
  for (const xc of D.hinge.xs) add(xc, D.hinge.len / 2, sY);
  for (const xc of D.latch.xs) add(xc, D.latch.span / 2, -sY);
  return blocks.length ? M().union(blocks) : null;
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
  P = ecoParams(P);                       // modo ahorro (sin efecto si está apagado)
  let D = derive(P);
  // ¿Se imprimirá inclinada? (misma huella que usa el optimizador de cama).
  // Entonces bisagras y orejetas quedan con el agujero a ~45° y llevan la
  // holgura extra calibrada para esa orientación (tiltAdd).
  if (P.printAids !== 'off' && !P._tilted && !fitsFlat(D, { x: P.bedX, y: P.bedY }).ok) {
    P = { ...P, _tilted: true };
    D = derive(P);
  }
  const parts = [];
  const normals = opt.normals !== false;
  const report = [];
  D.log = [];
  let tS = performance.now();
  const stage = (name) => { const t = performance.now(); log(D, `${name}: ${Math.round(t - tS)} ms`); tS = t; };
  if (D.eco) log(D, `modo ahorro de material: ${D.ecoChanges.join(', ') || 'ya estaba en mínimos'}`);
  if (D.tilted) log(D, `impresión inclinada prevista: agujeros de bisagra y cierre ${D.tiltAdd >= 0 ? '+' : ''}${D.tiltAdd} mm por lado`);
  log(D, `clase ${D.cls} · interior ${D.Li}×${D.Wi} · base ${D.Db} + tapa ${D.Dl} mm · pared ${D.t} · banda ${D.bo}${D.cham ? ` · octógono ${D.cham}` : ''}${D.stack ? ' · apilable' : ''}${D.rot90 ? ' · girada 90°' : ''}`);
  log(D, `bisagras ${D.hinge.n}×${D.hinge.nk} (nudillo ${D.hinge.kl} mm) en x=${D.hinge.xs.join(', ')} · cierres ${D.latch.n}×${D.latchW} mm en x=${D.latch.xs.join(', ')}`);
  try {
    const H = hinges(D);
    const L = latches(D);
    const z0 = D.z0;
    // Grupos para repartir el trabajo entre dos hilos: A = base, junta e
    // inserto de la base; B = tapa, cierres, pasadores e inserto de la tapa.
    const want = (g) => !opt.only || opt.only === g;

    // Base (reutilizada si solo cambian parámetros de la tapa).
    if (want('A')) {
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
      stage('base');
      addAids(D, P, bp, () => buildBase(D, H, L, []), normals);
      parts.push(bp);
      stage('ayudas base');
    }

    if (want('B')) {
      // Tapa (reutilizada si solo cambian el contenido, los insertos o las
      // ayudas de impresión: no la tocan).
      const key = lidKey(P, normals, svg);
      let lp, lidSolid = null;
      if (lidCache && lidCache.key === key) {
        lp = clonePart(lidCache.part);
        report.push(...lidCache.report);
        D.warn.push(...lidCache.warn);
      } else {
        const rep = [];
        const { lid, warn } = buildLid(D, P, H, L, svg, rep);
        report.push(...rep);
        D.warn.push(...warn);
        const extra = D.stack ? D.hs : D.relief === 'emboss' && (D.pattern !== 'smooth' || svg) ? D.pd : 0;
        lp = part('lid', 'Tapa', lid, {
          print: lidFlip(D, extra), instances: [T(0, 0, z0)], qty: 1, material: 'PETG / PLA / ASA',
        }, normals);
        lidSolid = lid;
        lidCache = { key, part: clonePart(lp), report: rep, warn: [...warn] };
      }
      stage('tapa');
      addAids(D, P, lp, () => lidSolid || buildLid(D, P, H, L, svg, []).lid, normals);
      parts.push(lp);
      stage('ayudas tapa');

      // Cierre: perfil acostado (X → Z de impresión).
      const lay = [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, D.latchW / 2, 1];
      parts.push(part('latch', 'Cierre', L.latch, {
        print: lay, instances: D.latch.xs.map((x) => T(x, 0, z0)),
        qty: D.latch.n, material: 'PETG (flexible) / PLA',
      }, normals));
    }

    // Tapas interiores del organizador (grupo A: la tapa ya es la pieza más
    // cara del grupo B, así los dos hilos de la vista rápida van parejos).
    // Las idénticas (misma forma salvo una traslación) son una sola pieza
    // con varias copias.
    if (want('A') && D.org && D.org.has) {
      const groups = new Map();
      for (const p of D.org.panels) {
        const rel = (v, o) => Math.round((v - o) * 100);
        const cellsRel = p.cells.map((i) => { const c = D.org.cells[i]; return [rel(c.x0, p.x0), rel(c.x1, p.x0), rel(c.y0, p.y0), rel(c.y1, p.y0), p.snapCells.includes(i) ? 1 : 0]; });
        const sig = JSON.stringify([rel(p.x1, p.x0), rel(p.y1, p.y0), p.clips.map((x) => rel(x, p.x0)), rel(p.tab, p.x0), cellsRel, D.cham > 0 ? [p.x0, p.y0] : 0]);
        if (!groups.has(sig)) groups.set(sig, []);
        groups.get(sig).push(p);
      }
      let k = 0;
      for (const list of groups.values()) {
        const ref = list[0];
        const O = D.org;
        const man = memoSolid(memoKey('org', ref, O.cells.filter((_, i) => ref.cells.includes(i)), O.a, O.zp0, O.zp1, O.rc, O.sealClr, O.snap,
          D.Li, D.Wi, D.cham, D.ri, D.seg, D.lw), () => ({ solid: orgPanel(D, ref) })).solid;
        k++;
        parts.push(part('orgPanel', groups.size > 1 ? `Tapa interior ${k}` : 'Tapa interior', man, {
          key: `orgPanel${k - 1}`,
          print: T(0, 0, -D.org.zp0),
          instances: list.map((p) => T(p.x0 - ref.x0, p.y0 - ref.y0, z0)),
          qty: list.length, material: 'PETG / PLA',
          axis: { y: ref.axis.y, z: ref.axis.z + z0 },
        }, normals));
      }
    }

    // Junta: si el anillo no cabe en la cama se divide en tramos rectos
    // (cortes en los lados largos, donde la ranura es recta). El TPU se
    // asienta a presión en la ranura y los tramos quedan a tope.
    const g = want('A') ? gasket(D) : null;
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

    // Insertos interiores.
    if (want('A') && P.insertMode && P.insertMode !== 'off') {
      const t1 = performance.now();
      const hasObjs = (P.contentObjects && P.contentObjects.length) || (P.contentPolys && P.contentPolys.length);
      const polys = P.insertMode === 'pockets' && hasObjs ? (P.contentPolys || []) : null;
      if (P.insertMode === 'pockets' && !hasObjs) D.warn.push('Inserto con huecos: añade los objetos (SVG) en la pestaña Contenido (se genera en blanco).');
      const ins = memoSolid(memoKey('ins', D.Li, D.Wi, D.ri, D.cham, D.seg, D.fc, D.lw, D.lh, D.Db, D.floorTop, D.draft, D.eco,
        ['contentObjects', 'fingerCount', 'fingerD', 'fingerPos', 'insertDeck', 'insertH', 'insertMode', 'insertTol', 'pocketTol', 'objClearance'].map((k) => P[k]), polys),
      () => baseInsert(D, P, polys));
      const ip = part('insert', polys ? 'Inserto con alojamientos' : 'Inserto', ins.solid, {
        print: ins.print, instances: [T(0, 0, z0)], qty: 1, material: 'PLA (relleno 0 %, 2 paredes)',
      }, normals);
      // Misma lógica de cama que la caja: diagonal + orejas, o inclinado con
      // bisel simétrico, aletas y soportes de voladizos.
      const tol = P.insertTol ?? 0.3;
      addAids(D, P, ip, () => ins.solid, normals, { hx: D.Li / 2 - tol, hy: D.Wi / 2 - tol, wall: 2 * D.lw + 0.6, mech: false });
      parts.push(ip);
      D.insert = ins.info;
      log(D, `inserto base: altura ${ins.info.height} mm, ${ins.info.pockets} alojamientos, ${ins.info.notches.length} huecos para dedos (${Math.round(performance.now() - t1)} ms)`);
    }
    if (want('B') && P.insertLid && D.org) D.warn.push('Con compartimentos en la tapa no se genera el inserto de la tapa.');
    if (want('B') && P.insertLid && !D.org) {
      const li = lidInsert(D, P);
      if (li) {
        const lp2 = part('insertLid', 'Inserto de tapa', li.solid, {
          print: li.print, instances: [T(0, 0, z0)], qty: 1, material: 'PLA (relleno 0 %, 2 paredes)',
        }, normals);
        const tol = P.insertTol ?? 0.3;
        addAids(D, P, lp2, () => li.solid, normals, { hx: D.Li / 2 - tol, hy: D.Wi / 2 - tol, wall: 2 * D.lw + 0.6, mech: false });
        parts.push(lp2);
      }
      else D.warn.push('Tapa demasiado baja para un inserto (< 3 mm de profundidad).');
    }

    // Pasadores: impresos o filamento + tapones, por separado para bisagra y cierre.
    const caps = [];
    D.filament = {};
    if (want('B')) {
      const axisZ = (d) => d / 2 - 0.12 * d;
      // Pasador con la cabeza en el lado `side` (−1: −X; +1: +X, girado 180° en Z).
      // Holgura axial de 0.2 mm entre la cabeza y la cara del nudillo/mejilla.
      const pinAt = (xc, span, side, y, z) => (side > 0 ? mul(T(xc + span / 2 + 0.2, y, z), ROTZ180) : T(xc - span / 2 - 0.2, y, z));
      if (D.pinMode === 'printed') {
        const hp = printedPin(D, D.hinge.len + 0.2, D.pinD);
        parts.push(part('hingePin', 'Pasador bisagra', hp.solid, {
          print: I4(),
          instances: D.hinge.xs.map((xc, i) => pinAt(xc, D.hinge.len, D.hinge.headSide[i], D.ya, D.za + z0 - axisZ(D.pinD))),
          qty: D.hinge.n, material: 'PETG / PLA (acostado)', length: hp.length,
        }, normals));
      } else {
        for (const xc of D.hinge.xs) caps.push({ a: xc - D.hinge.len / 2, b: xc + D.hinge.len / 2, y: D.ya, z: D.za });
        D.filament.hinge = filamentLength(D.hinge.len); D.filament.hingeQty = D.hinge.n;
      }
      if (D.latchPinMode === 'printed') {
        const lpn = printedPin(D, D.latch.span + 0.2, D.latchPinD);
        parts.push(part('latchPin', 'Pasador cierre', lpn.solid, {
          print: I4(),
          instances: D.latch.xs.map((xc, i) => pinAt(xc, D.latch.span, D.latch.headSide[i], D.yp, D.zp + z0 - axisZ(D.latchPinD))),
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
    }

    stage('resto de piezas');
    // Integridad: una pieza rígida debe ser UN solo sólido (trozos sueltos =
    // geometría incompleta) y la malla debe ser válida.
    for (const p of parts) {
      if (p.status !== 'NoError') D.warn.push(`${p.name}: malla con error (${p.status}).`);
      if (p.components > 1 && p.id !== 'gasket') {
        D.warn.push(`${p.name}: ${p.components} trozos separados (revisa el registro).`);
        log(D, `AVISO ${p.name}: ${p.components} componentes`);
      }
    }
    log(D, `piezas: ${parts.map((p) => `${p.name} ${p.tris} tri ${p.components} comp`).join(' · ')}`);
    D.hullLine = report;

    return {
      ok: true,
      D: JSON.parse(JSON.stringify(D)),
      parts,
      assembly: { hinge: { y: D.ya, z: D.za + z0 }, latch: { y: D.yp, z: D.zp + z0 }, z0, rot90: D.rot90 },
      ms: Math.round(performance.now() - t0),
      only: opt.only || null,
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
    components: man.decompose().length,
    tris: man.numTri(),
    bbox: man.boundingBox(),
    ...extra,
  };
}

/* ---------------- Caché de la base ---------------- */
let baseCache = null;
const LID_ONLY = new Set(['orgDepth', 'orgScoop', 'pattern', 'relief', 'patternDepth', 'patternSize', 'patternRib',
  'patternMargin', 'stripeAngle', 'patternSeed', 'svgSize', 'svgRotate', 'svgOffsetX', 'svgOffsetY',
  'top', 'lidDepth', 'lidMin', 'bedPreset', 'bedX', 'bedY', 'bedZ', 'printAids', 'aidsInPart',
  'finSpacing', 'finReach', 'toothPitch', 'finGap', 'overhangSupports', 'overhangAngle', 'supportPitch',
  'insertMode', 'insertLid', 'insertH', 'insertTol', 'pocketTol', 'insertDeck', 'fingerCount', 'fingerD',
  'fingerPos', 'holeComp', 'contentPolys', 'contentObjects', 'objClearance', 'objRotate', 'objSpacing', 'objRotateAllow', 'contentFit']);
function baseKey(P, normals) {
  const o = {};
  for (const k of Object.keys(P).sort()) if (!LID_ONLY.has(k)) o[k] = P[k];
  return JSON.stringify(o) + normals;
}
/* ---------------- Caché de la tapa ---------------- */
// Simétrica a la de la base: estos parámetros no cambian la malla de la tapa
// (antes de las ayudas, que tienen su propia caché por huella de malla). Al
// ajustar el contenido o el inserto el hilo B ya no repite la tapa entera.
let lidCache = null;
const NOT_LID = new Set(['insertMode', 'insertLid', 'insertH', 'insertTol', 'pocketTol', 'insertDeck', 'fingerCount', 'fingerD',
  'fingerPos', 'contentPolys', 'contentObjects', 'objClearance', 'objRotate', 'objSpacing', 'objRotateAllow', 'contentFit',
  'aidsInPart', 'finSpacing', 'finReach', 'toothPitch', 'finGap', 'overhangSupports', 'overhangAngle', 'supportPitch']);
function lidKey(P, normals, svg) {
  const o = {};
  for (const k of Object.keys(P).sort()) if (!NOT_LID.has(k)) o[k] = P[k];
  return JSON.stringify(o) + normals + (svg || '');
}
function clonePart(p) {
  return { ...p, mesh: { ...p.mesh, vert: p.mesh.vert.slice(), tri: p.mesh.tri.slice() } };
}

/** Para pruebas: acceso a la geometría cruda sin liberar memoria. */
export const _internal = { derive, hinges, latches, buildBase, buildLid, knuckleSpans, M, cleanup, criticalLayers, LID_ONLY, NOT_LID };
