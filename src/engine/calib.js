/**
 * calib.js — Test de holguras UNIVERSAL y aplicación de resultados.
 *
 * Las holguras dependen de la IMPRESORA, el MATERIAL y la ORIENTACIÓN con la
 * que se imprime cada unión (en FDM una cota en XY sale distinta que una en Z
 * y un agujero horizontal distinto de uno vertical o inclinado). Cada probeta
 * reproduce una unión de la caja con su misma orientación de impresión:
 *
 *   unión de la caja                          cómo se imprime en la caja → probeta
 *   ─────────────────────────────────────────  ─────────────────────────────────────
 *   nudillos de bisagra y orejetas (base, tapa) agujero HORIZONTAL en gota → A, P3, P5
 *   ídem si la caja no cabe plana              agujero INCLINADO ~45°     → F
 *   barril del cierre, tapones                 agujero VERTICAL           → B
 *   ranura (base) y lengüeta (tapa boca abajo) paredes verticales, XY     → C
 *   marco de apilado (tapa) y pie (base)       PRIMERA CAPA, pata de elefante → d
 *   retén del cierre (puente de la tapa)       cara inferior de un puente → E
 *   pasadores impresos                         acostados, cara plana      → P3, P5
 *
 * Modo "universal" (por defecto): todas las probetas, con medidas de
 * referencia que cubren de la caja XS a la L (filamento 1.75, pasadores
 * impresos Ø3 y Ø5 —entre ambos se interpola—, cierre de clase S). Vale para
 * cualquier caja que se cree después. Modo "box": solo las uniones que usa
 * la caja actual, con sus medidas exactas (menos material).
 *
 * El filamento 1.75 sirve de CALIBRE (±0.02 mm, redondo y liso): con él se
 * aíslan los efectos de la orientación (horizontal / vertical / inclinado)
 * sin mezclar el error del propio pasador impreso.
 *
 * Valores de partida (investigación, ver README): giratorio 0.2–0.3 mm por
 * lado; deslizante 0.15–0.25 (PLA) / 0.2–0.3 (PETG) / 0.25–0.35 (ASA);
 * agujeros verticales 0.1–0.3 mm menores; series de prueba de 0.05 en 0.05.
 *
 * Todo plano, sin soportes ni puentes > 10 mm, paredes ≥ 2 líneas y números
 * en relieve de 2 líneas de trazo.
 */
import { M, CS, cleanup, toMesh, teardrop, prism, yzExtrude } from './geo.js';
import { derive, DEFAULTS } from './params.js';
import { printedPin, filamentCap } from './pins.js';
import { latches } from './latch.js';
import { rrOffset } from './seal.js';
import { fitsFlat } from '../optimizer.js';
import { M as Msg } from '../i18n/msg.js';

/** Parámetros que forman el perfil de calibración (de la impresora). */
export const CAL_KEYS = ['filClr', 'clearance', 'clearanceL', 'tiltAdd', 'holeComp', 'sealClr', 'axialGap',
  'stackClr', 'latchPre', 'insertTol', 'pocketTol'];

export const CAL_LIMITS = {
  filClr: [0.025, 0.4], clearance: [0.05, 0.5], clearanceL: [0.05, 0.5], tiltAdd: [-0.2, 0.4], holeComp: [0, 0.6],
  sealClr: [0.05, 0.6], axialGap: [0.2, 0.8], stackClr: [0.1, 0.8], latchPre: [0, 0.5], insertTol: [0.05, 1.5], pocketTol: [0.3, 3],
};

/** Ajustes de la impresora que se copian a las cajas de referencia. */
const PRINTER_KEYS = ['lineWidth', 'layerH', 'snapToPrinter', 'bedX', 'bedY', 'bedZ', 'bedPreset', 'maxBridge'];

const r3 = (v) => Math.round(v * 1000) / 1000;
const clampK = (k, v) => Math.min(CAL_LIMITS[k][1], Math.max(CAL_LIMITS[k][0], v));

/** Caja de referencia para el cierre universal: clase S, filamento. */
function refBox(P) {
  const o = { ...DEFAULTS };
  for (const k of [...PRINTER_KEYS, ...CAL_KEYS]) if (P[k] !== undefined) o[k] = P[k];
  return { ...o, innerL: 60, innerW: 40, baseDepth: 21, lidDepth: 9, sizeClass: 'S', pinMode: 'filament', sealMode: 'tpu', stackable: false };
}

/**
 * Plan del test (función pura): qué probetas, con qué holguras.
 * @param P     parámetros actuales (incluye los valores del perfil)
 * @param opt   { mode: 'universal' | 'box', fine: paso 0.025, n: variantes }
 */
export function calibPlan(P, opt = {}) {
  const mode = opt.mode === 'box' ? 'box' : 'universal';
  const D = derive({ ...P, quality: 'preview' });
  const n = opt.n || 5;
  const step = opt.fine ? 0.025 : 0.05;
  const half = Math.floor(n / 2);
  const series = (k, center, nn = n, st = step) => {
    // Centrada en el valor actual; si toca un límite se desplaza hacia dentro.
    const [lo, hi] = CAL_LIMITS[k];
    const hf = Math.floor(nn / 2);
    let c = clampK(k, center);
    if (c - hf * st < lo) c = lo + hf * st;
    if (c + hf * st > hi) c = hi - hf * st;
    return Array.from({ length: nn }, (_, i) => r3(c + (i - hf) * st));
  };
  const usesFil = D.pinMode === 'filament' || D.latchPinMode === 'filament';
  const usesPrinted = D.pinMode === 'printed' || D.latchPinMode === 'printed';
  const tilted = P.printAids !== 'off' && !fitsFlat(D, { x: P.bedX, y: P.bedY }).ok;
  const want = (k) => mode === 'universal' || k;
  const Lk = mode === 'universal' ? 6 : r3(Math.min(8, Math.max(6, D.hinge.kl)));
  const filC = P.filClr ?? 0.125;
  const tests = [];

  if (want(usesFil)) {
    tests.push({
      id: 'A', key: 'filClr', label: Msg('cal.A.label'), piece: 'hinge', mode: 'filament', pinD: 1.75, len: Lk,
      variants: series('filClr', filC).map((v, i) => ({ n: i + 1, value: v, d: r3(1.75 + 2 * v) })),
      how: Msg('cal.A.how'),
    });
  }
  const pinRow = (id, key, pinD, center, label) => ({
    id, key, label, piece: 'hinge', mode: 'printed', pinD, len: Lk,
    variants: series(key, center).map((v, i) => ({ n: i + 1, value: v, d: r3(pinD + 2 * v) })),
    how: Msg('cal.P.how', { d: pinD }),
  });
  if (mode === 'universal') {
    tests.push(pinRow('P3', 'clearance', 3, P.clearance ?? 0.25, Msg('cal.P3.label')));
    tests.push(pinRow('P5', 'clearanceL', 5, P.clearanceL ?? P.clearance ?? 0.25, Msg('cal.P5.label')));
  } else if (usesPrinted || ((D.org && D.org.has) || (D.orgB && D.orgB.has))) {
    // Pasador impreso de la caja o, si solo usa filamento, el eje Ø3 de las
    // tapas interiores del organizador (misma unión: eje acostado en agujero
    // horizontal de la tapa).
    const d = !usesPrinted ? 3 : D.pinMode === 'printed' ? D.pinD : D.latchPinD;
    const c0 = !usesPrinted ? (P.clearance ?? 0.25) : D.pinMode === 'printed' ? D.clr : D.clrL;
    tests.push({ ...pinRow('P', 'clearance', d, c0, usesPrinted ? Msg('cal.P.labelBox', { d }) : Msg('cal.P.labelAxle')), scaled: true });
  }
  if (want(tilted)) {
    tests.push({
      id: 'F', key: 'tiltAdd', label: Msg('cal.F.label'), piece: 'tilted', mode: 'filament', pinD: 1.75, len: Lk,
      filC, variants: series('tiltAdd', P.tiltAdd ?? 0).map((v, i) => ({ n: i + 1, value: v, d: r3(1.75 + 2 * (filC + v)) })),
      how: Msg('cal.F.how'),
    });
  }
  // B: agujero vertical (barril del cierre, tapones). En universal, con el
  // filamento como calibre; en "box", con el pasador real de la caja.
  const latchFil = mode === 'universal' || D.latchPinMode === 'filament';
  const latchHole = latchFil ? r3(1.75 + 2 * filC) : r3(D.latchPinD + 2 * D.clrL);
  tests.push({
    id: 'B', key: 'holeComp', label: Msg('cal.B.label', { caps: mode === 'universal' || usesFil }), piece: 'bore',
    mode: latchFil ? 'filament' : 'printed', pinD: latchFil ? 1.75 : D.latchPinD, baseHole: latchHole,
    len: mode === 'universal' ? 6 : r3(Math.min(8, Math.max(4, D.latchW))), caps: mode === 'universal' || usesFil,
    variants: series('holeComp', P.holeComp ?? 0.15).map((v, i) => ({ n: i + 1, value: v, d: r3(latchHole + v), cap: r3(1.55 + v) })),
    how: Msg('cal.B.how', { fil: latchFil, caps: mode === 'universal' || usesFil }),
  });
  // C: lengüeta y ranura (deslizante entre paredes verticales).
  const twRef = mode === 'universal' ? 2.2 : D.tw;
  tests.push({
    id: 'C', key: 'sealClr', label: Msg('cal.C.label'), piece: 'tongue', tw: twRef, tl: mode === 'universal' ? 2.4 : D.tl,
    variants: series('sealClr', P.sealClr ?? 0.25).map((v, i) => ({ n: i + 1, value: v, w: r3(twRef + 2 * v) })),
    how: Msg('cal.C.how'),
  });
  // d: apilado (marco de la tapa y pie de la base, los dos en la primera capa).
  if (want(D.stack)) {
    tests.push({
      id: 'd', key: 'stackClr', label: Msg('cal.d.label'), piece: 'stack',
      variants: series('stackClr', P.stackClr ?? 0.3).map((v, i) => ({ n: i + 1, value: v })),
      how: Msg('cal.d.how'),
    });
  }
  // E: precarga del cierre (gancho real sobre el retén, que es un puente).
  tests.push({
    id: 'E', key: 'latchPre', label: Msg('cal.E.label'), piece: 'latch', ref: mode === 'universal' ? 'S' : D.cls,
    // 3 puestos con paso doble: el útil es la probeta más pesada y la
    // precarga tolera más que un ajuste de pasador.
    stepE: 2 * step,
    variants: series('latchPre', P.latchPre ?? 0.15, 3, 2 * step).map((v, i) => ({ n: i + 1, value: v })),
    how: Msg('cal.E.how'),
  });

  // Solo algunas probetas (repetir las que quedaron fuera de rango o medir
  // las que faltan): el resto ya está bien medido y no se reimprime.
  const only = Array.isArray(opt.only) && opt.only.length ? new Set(opt.only) : null;
  const onlyKeys = Array.isArray(opt.onlyKeys) && opt.onlyKeys.length ? new Set(opt.onlyKeys) : null;
  const kept = tests.filter((t) => (!only || only.has(t.id)) && (!onlyKeys || onlyKeys.has(t.key)
    || (t.key === 'clearance' && onlyKeys.has('clearanceL'))));
  return {
    version: 2, mode, created: Date.now(), fine: !!opt.fine, step, n,
    partial: only || onlyKeys ? kept.map((t) => t.id) : null,
    lw: D.lw ?? P.lineWidth, lh: D.lh ?? P.layerH, cls: D.cls,
    summary: Msg('cal.summary', { universal: mode === 'universal', cls: D.cls, fil: usesFil, printed: usesPrinted, tilted, stack: !!D.stack,
      only: only || onlyKeys ? kept.map((t) => t.id).join(', ') : '' }),
    tests: kept,
  };
}

/* ================================================================ */
/*  Aplicación de resultados                                        */
/* ================================================================ */

/**
 * @param plan     plan con el que se imprimió el test
 * @param choices  { [testId]: n (1..N) | 'tight' | 'loose' | null }
 *                 tight = hasta la más holgada quedó dura; loose = hasta la
 *                 más justa quedó floja.
 * @param current  valores actuales del perfil
 * @returns { values, changes: [{k, from, to, why}], retest }
 */
export function applyResults(plan, choices, current) {
  const values = { ...current };
  const changes = [];
  let retest = false;
  const retestIds = [];
  const set = (k, v, why) => {
    const to = r3(clampK(k, v));
    if (Math.abs(to - (current[k] ?? to)) > 1e-6) changes.push({ k, from: current[k], to, why });
    values[k] = to;
  };
  const pick = (t) => {
    const c = choices[t.id];
    if (c == null || c === '') return null;
    const vs = t.variants;
    // Si quedó fuera del rango (preCarga: "tight" = no cierra → menos precarga).
    const sign = t.key === 'latchPre' ? -1 : 1;
    const st = t.stepE || plan.step;
    if (c === 'tight') { retest = true; retestIds.push(t.id); return sign > 0 ? vs[vs.length - 1].value + st : vs[0].value - st; }
    if (c === 'loose') { retest = true; retestIds.push(t.id); return sign > 0 ? vs[0].value - st : vs[vs.length - 1].value + st; }
    const v = vs.find((x) => x.n === Number(c));
    return v ? v.value : null;
  };
  const byId = (id) => plan.tests.find((t) => t.id === id);
  const tA = byId('A');
  if (tA) { const v = pick(tA); if (v != null) set('filClr', v, Msg('cal.why.test', { id: 'A' })); }
  for (const id of ['P3', 'P5']) {
    const t = byId(id);
    if (t) { const v = pick(t); if (v != null) set(t.key, v, Msg('cal.why.test', { id })); }
  }
  const tP = byId('P');
  if (tP) {
    // Modo "esta caja": se midió un solo diámetro. Se desplazan Ø3 y Ø5 lo
    // mismo para que la holgura interpolada en ese diámetro sea la medida.
    const v = pick(tP);
    if (v != null) {
      const a = current.clearance ?? 0.25, b = current.clearanceL ?? a;
      const now = a + (b - a) * Math.min(1, Math.max(0, (tP.pinD - 3) / 2));
      set('clearance', a + (v - now), Msg('cal.why.testD', { id: 'P', d: tP.pinD }));
      set('clearanceL', b + (v - now), Msg('cal.why.testD', { id: 'P', d: tP.pinD }));
    }
  }
  const tF = byId('F');
  if (tF) {
    const v = pick(tF);
    // Medido con el filamento como calibre: holgura absoluta a 45° menos la
    // horizontal (que A puede haber cambiado a la vez).
    if (v != null) set('tiltAdd', tF.filC + v - values.filClr, Msg('cal.why.test', { id: 'F' }));
  }
  const tB = byId('B');
  if (tB) {
    const h = pick(tB);
    if (h != null) {
      // Se mide el DIÁMETRO absoluto que funciona; si A/P cambiaron la holgura
      // de giro, la compensación se recalcula para mantener ese diámetro.
      const d = tB.baseHole + h;
      let newBase;
      if (tB.mode === 'filament') newBase = 1.75 + 2 * values.filClr;
      else {
        const a = values.clearance, b = values.clearanceL ?? a;
        newBase = tB.pinD + 2 * (a + (b - a) * Math.min(1, Math.max(0, (tB.pinD - 3) / 2)));
      }
      set('holeComp', d - newBase, Msg('cal.why.testHole', { id: 'B', d: r3(d) }));
    }
  }
  const tC = byId('C');
  if (tC) {
    const s = pick(tC);
    if (s != null) {
      set('sealClr', s, Msg('cal.why.test', { id: 'C' }));
      // Misma familia (deslizante entre paredes verticales):
      //   nudillos +0.15 (caras largas que no deben rozar al girar)
      //   inserto +0.05 · objeto en su hueco +0.35 (objetos reales)
      //   apilado +0.05 solo si no se midió con la probeta d
      set('axialGap', s + 0.15, Msg('cal.why.from', { id: 'C' }));
      set('insertTol', s + 0.05, Msg('cal.why.from', { id: 'C' }));
      set('pocketTol', Math.max(0.4, s + 0.35), Msg('cal.why.from', { id: 'C' }));
      if (!byId('d') || choices.d == null || choices.d === '') set('stackClr', s + 0.05, Msg('cal.why.from', { id: 'C' }));
    }
  }
  const tD = byId('d');
  if (tD) { const v = pick(tD); if (v != null) set('stackClr', v, Msg('cal.why.test', { id: 'd' })); }
  const tE = byId('E');
  if (tE) { const v = pick(tE); if (v != null) set('latchPre', v, Msg('cal.why.test', { id: 'E' })); }
  return { values, changes, retest, retestIds };
}

/* ================================================================ */
/*  Geometría de las probetas                                       */
/* ================================================================ */

// Siete segmentos: a (arriba), b (arriba der.), c (abajo der.), d (abajo),
// e (abajo izq.), f (arriba izq.), g (centro).
const SEG7 = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  A: 'abcefg', B: 'cdefg', C: 'adef', D: 'bcdeg', d: 'bcdeg', E: 'adefg', F: 'aefg', P: 'abefg', H: 'bcefg', L: 'def',
};

/** Texto en siete segmentos (CrossSection), esquina inferior izquierda en (x, y). */
function seg7(text, x, y, h, stroke) {
  const w = h * 0.55;
  const out = [];
  let cx = x;
  for (const ch of String(text)) {
    const segs = SEG7[ch] || '';
    const s = stroke, hh = h / 2;
    const rect = (x0, y0, x1, y1) => CS().square([x1 - x0, y1 - y0], false).translate([x0, y0]);
    const R = {
      a: rect(cx, y + h - s, cx + w, y + h), d: rect(cx, y, cx + w, y + s), g: rect(cx, y + hh - s / 2, cx + w, y + hh + s / 2),
      f: rect(cx, y + hh, cx + s, y + h), e: rect(cx, y, cx + s, y + hh), b: rect(cx + w - s, y + hh, cx + w, y + h), c: rect(cx + w - s, y, cx + w, y + hh),
    };
    for (const k of segs) out.push(R[k]);
    cx += w + s * 1.6;
  }
  return out.length ? CS().union(out) : null;
}
const seg7Width = (text, h, stroke) => String(text).length * (h * 0.55 + stroke * 1.6) - stroke * 1.6;

/** Pestaña frontal con los números en relieve, de x0 a x1, en y ∈ [−depth, 0]. */
function labelFlange(x0, x1, labels, G) {
  const { ft, emb, th, ts, depth } = G;
  let m = M().cube([x1 - x0, depth, ft]).translate([x0, -depth, 0]);
  const marks = [];
  for (const { text, x } of labels) {
    const w = seg7Width(text, th, ts);
    const cs = seg7(text, x - w / 2, -depth + (depth - th) / 2, th, ts);
    if (cs) marks.push(prism(cs, ft - 0.01, ft + emb));
  }
  if (marks.length) m = m.add(M().union(marks));
  return m;
}

/** Barra de nudillos con agujeros horizontales en gota (eje a lo largo de Y). */
function hingeBar(t, G) {
  const ds = t.variants.map((v) => v.d);
  const dmax = Math.max(...ds);
  // Pared de 2 mm: el ajuste depende del agujero, no del grosor del nudillo.
  const wall = Math.max(G.wallMin, 2.0);
  const cw = dmax + 2 * wall;                            // ancho de cada nudillo
  const pitch = cw + 2;                                  // nudillos separados 2 mm
  const endX = 5 + 4.5 * t.id.length;                   // sitio para la letra
  const L = endX + t.variants.length * pitch;
  const zc = wall + dmax / 2;
  const H = zc + (dmax / 2) * Math.SQRT2 + wall;
  // Perfil en (x, v) extruido a lo largo de L y girado: v → z, extrusión → −y.
  // Un "nudillo" rectangular por variante, con su agujero en gota (punta
  // arriba), como los de la base y la tapa.
  const towers = t.variants.map((v, i) => {
    const x = endX + pitch * (i + 0.5);
    return CS().square([cw, H], false).translate([x - cw / 2, 0]).subtract(teardrop(x, zc, v.d / 2, true, G.seg));
  });
  const prof = CS().union(towers);
  const bar = prof.extrude(t.len).rotate([90, 0, 0]).translate([0, t.len, 0]);
  const labels = [{ text: t.id, x: endX / 2 + (t.id.length - 1) * 2 }, ...t.variants.map((v, i) => ({ text: v.n, x: endX + pitch * (i + 0.5) }))];
  return bar.add(labelFlange(0, L, labels, G));
}

/**
 * Barriles con agujero vertical (como el del cierre) sobre la pestaña de
 * números, y tapones pinza unidos por una pestaña que se parte. Cada barril
 * es un cilindro independiente (menos material que una placa maciza).
 */
function borePlate(t, G, D) {
  const dmax = Math.max(...t.variants.map((v) => v.d));
  const wall = Math.max(G.wallMin, 2.0);
  const Rb = dmax / 2 + wall;
  const pitch = Math.max(2 * Rb + 2, t.caps ? 7 : 0);
  const endX = 7;
  const L = endX + t.variants.length * pitch;
  const T = t.len;
  const c = 0.4;
  const yc = Rb - 0.8;                                   // solapa 0.8 mm con la pestaña
  const bosses = [];
  for (const [i, v] of t.variants.entries()) {
    const x = endX + pitch * (i + 0.5), r = v.d / 2;
    let boss = M().cylinder(T, Rb, Rb, G.seg).translate([x, yc, 0]);
    const bore = M().cylinder(T + 2, r, r, G.seg).translate([x, yc, -1]);
    const cone = M().cylinder(c + 0.01, r + c, r, G.seg);                       // ancho abajo
    boss = boss.subtract(bore).subtract(cone.translate([x, yc, -0.01])).subtract(cone.mirror([0, 0, 1]).translate([x, yc, T + 0.01]));
    bosses.push(boss);
  }
  const labels = [{ text: 'B', x: endX / 2 }, ...t.variants.map((v, i) => ({ text: v.n, x: endX + pitch * (i + 0.5) }))];
  // La pestaña no debe tapar los agujeros: se recorta alrededor de cada barril.
  let flange = labelFlange(0, L, labels, G);
  for (const [i] of t.variants.entries()) flange = flange.subtract(M().cylinder(G.ft + 2, Rb - 0.01, Rb - 0.01, G.seg).translate([endX + pitch * (i + 0.5), yc, -1]));
  let piece = M().union([flange, ...bosses]);
  if (t.caps) {
    // Tapón pinza delante de cada número, unido por una pestaña fina.
    const R = D.capR ?? 2.0;
    const caps = [];
    for (const [i, v] of t.variants.entries()) {
      const x = endX + pitch * (i + 0.5);
      const ycap = -G.depth - 1.2 - R;
      const cap = filamentCap({ ...D, capHoleD: v.cap, seg: G.seg }).translate([x, ycap, 0]);
      const tab = M().cube([1.0, 1.2 + 0.8, 0.6]).translate([x - 0.5, -G.depth - 1.2 - 0.6, 0]);
      caps.push(cap, tab);
    }
    piece = piece.add(M().union(caps));
  }
  return piece;
}

/** Bloque con ranuras abiertas (como la ranura de la base). */
function grooveBlock(t, G) {
  const ws = t.variants.map((v) => v.w);
  const wall = Math.max(G.wallMin, 2.0);
  const pitch = Math.max(...ws) + 2 * wall;
  const endX = 7;
  const L = endX + t.variants.length * pitch;
  const Ls = 12;                                         // largo de cada ranura
  const depth = r3(t.tl + 0.6);
  const H = depth + Math.max(1.2, 6 * G.lh);
  let block = M().cube([L, Ls, H]);
  const ch = 0.4;                                        // chaflán de entrada, como la caja
  for (const [i, v] of t.variants.entries()) {
    const x = endX + pitch * (i + 0.5);
    const slot = M().cube([v.w, Ls + 2, depth + 1]).translate([x - v.w / 2, -1, H - depth]);
    const lead = M().hull([
      M().cube([v.w, Ls + 2, 0.01]).translate([x - v.w / 2, -1, H - ch - 0.01]),
      M().cube([v.w + 2 * ch, Ls + 2, 0.01]).translate([x - v.w / 2 - ch, -1, H + 0.01]),
    ]);
    block = block.subtract(slot).subtract(lead);
  }
  const labels = [{ text: 'C', x: endX / 2 }, ...t.variants.map((v, i) => ({ text: v.n, x: endX + pitch * (i + 0.5) }))];
  return block.add(labelFlange(0, L, labels, G));
}

/** Lengüeta real (escalones 100 % / −0.2 / −0.4) sobre una placa, punta arriba. */
function tonguePiece(t, G) {
  const Ls = 11, base = Math.max(1.2, 6 * G.lh);
  const W = t.tw + 10, L = Ls + 4;
  let m = M().cube([L, W, base]);
  let z = base;
  for (const [frac, shrink] of [[0.5, 0], [0.3, 0.2], [0.2, 0.4]]) {
    const w = t.tw - shrink, h = t.tl * frac;
    m = m.add(M().cube([Ls, w, h + 0.01]).translate([2, W / 2 - w / 2, z - 0.01]));
    z += h;
  }
  // "C" en relieve en la placa, junto a la lengüeta.
  const th = Math.min(4, (W - t.tw) / 2 - 1.5);
  const cs = seg7('C', 2, 0.6, th, G.ts);
  if (cs && th > 2.4) m = m.add(prism(cs, base - 0.01, base + G.emb));
  return m;
}


/**
 * Nudillos INCLINADOS 45° (como las bisagras de una caja impresa inclinada):
 * cada nudillo es el de la probeta A girado 45° alrededor de X, con el pie
 * recortado en plano sobre una placa. Caras a 45°: sin soporte.
 */
function tiltedBar(t, G) {
  const dmax = Math.max(...t.variants.map((v) => v.d));
  const wall = Math.max(G.wallMin, 2.0);
  const cw = dmax + 2 * wall, H = cw, Ln = t.len;
  const pitch = cw + 2, endX = 9;
  const L = endX + t.variants.length * pitch;
  const knuckles = [];
  let ymax = 0;
  for (const [i, v] of t.variants.entries()) {
    const x = endX + pitch * (i + 0.5);
    // Nudillo con el agujero a lo largo de Y, centrado en el origen (YZ).
    const prof = CS().square([cw, H], false).translate([-cw / 2, -H / 2]).subtract(teardrop(0, 0, v.d / 2, true, G.seg));
    let k = prof.extrude(Ln).rotate([90, 0, 0]).translate([0, Ln / 2, 0]).rotate([45, 0, 0]);
    const bb = k.boundingBox();
    k = k.translate([x, -bb.min[1], G.ft - bb.min[2] - 1.0]).trimByPlane([0, 0, 1], G.ft - 0.01);
    ymax = Math.max(ymax, bb.max[1] - bb.min[1]);
    knuckles.push(k);
  }
  const plate = M().cube([L, ymax, G.ft]);
  const labels = [{ text: 'F', x: endX / 2 }, ...t.variants.map((v, i) => ({ text: v.n, x: endX + pitch * (i + 0.5) }))];
  return M().union([plate, labelFlange(0, L, labels, G), ...knuckles]);
}

/**
 * Apilado: 5 marcos (como el de la tapa: cara interior vertical, exterior a
 * 45°) y una pieza "base" con pie, canal y faldón a 45° (como el fondo de la
 * base). Ambos se imprimen con la cara de contacto sobre la cama.
 */
function stackPieces(t, G, sRef) {
  const Dm = { Li: 16, Wi: 10, ri: 2.5, cham: 0, seg: G.seg };
  const hs = 2.0, hf = 2.3, fwT = Math.max(1.6, G.wallMin + 0.4);
  const Q = 2 * sRef + fwT + hs;                       // cara interior del faldón en z = 0
  // Pieza base: tapa maciza arriba, pie dentro, canal y faldón a 45°.
  const skin = Math.max(1.2, 6 * G.lh);
  const outer = rrOffset(Dm, Q + fwT);
  let cap = prism(outer, 0, hf + skin);
  const channel = M().hull([prism(rrOffset(Dm, Q), -0.01, 0), prism(rrOffset(Dm, Q - hf), hf - 0.01, hf)])
    .subtract(prism(rrOffset(Dm, 0), -1, hf + 1));
  cap = cap.subtract(channel);
  const lab = seg7('d', -2, -2.2, 4.2, G.ts);
  if (lab) cap = cap.add(prism(lab, hf + skin - 0.01, hf + skin + G.emb));
  // Marcos: interior a s, exterior (cono) a Q − s en la cara ancha.
  const frames = [];
  const pitch = 16 + 2 * Q + 3;
  for (const [i, v] of t.variants.entries()) {
    const s = v.value;
    const x = pitch * (i + 0.5);
    const cone = M().hull([prism(rrOffset(Dm, Q - s - hs), 0, 0.01), prism(rrOffset(Dm, Q - s), hs - 0.01, hs)]);
    const fr = cone.subtract(prism(rrOffset(Dm, s), -1, hs + 1)).translate([x, 0, 0]);
    frames.push(fr);
  }
  const W = 10 + 2 * Q;
  const L = pitch * t.variants.length;
  // Barra de unión con los números, delante de los marcos.
  const labels = t.variants.map((v, i) => ({ text: v.n, x: pitch * (i + 0.5) }));
  const flange = labelFlange(pitch * 0.5 - 6, L - pitch * 0.5 + 6, labels, G).translate([0, -W / 2 + 0.6, 0]);
  const bars = t.variants.map((v, i) => M().cube([2, 2.2, G.ft]).translate([pitch * (i + 0.5) - 1, -W / 2 - 0.6, 0]));
  return { frames: M().union([...frames, flange, ...bars]), cap };
}

/**
 * Cierre con precarga: útil con 5 puestos (orejetas + mejillas + retén reales
 * de la caja de referencia) en los que el retén sube o baja la diferencia de
 * precarga, y el cierre real con su pasador. El útil se imprime boca abajo,
 * como la tapa: el retén es un puente y su cara de agarre la de debajo.
 */
function latchFixture(t, G, Dr) {
  const D = { ...Dr, seg: G.seg };
  const Lg = latches(D);
  const xc = D.latch.xs[0];
  const span = D.latchW + 2 * (D.ag + D.cheekW);
  const x0 = xc - span / 2 - 0.5, x1 = xc + span / 2 + 0.5;
  const box = (ya, yb, za, zb) => M().cube([x1 - x0, yb - ya, zb - za]).translate([x0, ya, za]);
  const zBand = D.Hb - D.bandH;
  // Solo la franja que importa: del pie del barril (eje − rl − 2.5) a 2 mm
  // por encima del retén. Lo que la caja tiene fuera (chaflanes a 45° de
  // las mejillas, pared) no cambia el ajuste y sería material.
  const zClip0 = D.zp - D.rl - 2.5, zClip1 = D.zkt + 2.0;
  const range = box(-D.sh - 5, 5, zClip0, zClip1);
  const stations = [];
  const pitch = x1 - x0 + 2;
  const n = t.variants.length;
  for (const [i, v] of t.variants.entries()) {
    const dz = v.value - D.pre;                         // el retén sube o baja
    // Solo la mecánica real (orejetas, mejillas, retén) y la banda que las
    // une: la pared de la caja no aporta nada al ajuste y sería material.
    let st = M().union([
      Lg.lugs.intersect(range), Lg.lidCheeks.intersect(range),
      Lg.keepers.intersect(range).translate([0, 0, dz]),
    ]);
    // Agujero de las orejetas: gota hacia ABAJO en el mundo = hacia arriba
    // al imprimir boca abajo.
    st = st.subtract(yzExtrude(teardrop(-D.sp, D.zp, D.latchHoleD / 2, false, D.seg), x0 - 1, x1 + 1));
    stations.push(st.translate([i * pitch - x0, 0, 0]));
  }
  // Banda continua (base + tapa cerradas) que une los puestos.
  let band = M().cube([n * pitch - 2, D.sb - D.sw + 0.6, zClip1 - zBand]).translate([0, -D.sb, zBand]);
  for (let i = 0; i < n; i++) band = band.subtract(Lg.pockets.intersect(range).translate([i * pitch - x0, 0, 0]));
  stations.push(band);
  let fix = M().union(stations);
  // Boca abajo (como la tapa): z → −z, y → −y.
  fix = fix.rotate([180, 0, 0]);
  const bb = fix.boundingBox();
  fix = fix.translate([0, -bb.min[1], -bb.min[2]]);
  // Números en una pestaña sobre la cama, pegada a la pared del útil.
  const fb = fix.boundingBox();
  const labels = [{ text: 'E', x: 3 }, ...t.variants.map((v, i) => ({ text: v.n, x: i * pitch + (x1 - x0) / 2 }))];
  const flange = labelFlange(fb.min[0] - 2, fb.max[0], labels, G).translate([0, 0.6, 0]);
  // El cierre real, de lado (como en la caja).
  let latch = Lg.latch.translate([-xc, 0, 0]).rotate([0, 90, 0]);
  const lb = latch.boundingBox();
  latch = latch.translate([-lb.min[0], -lb.min[1], -lb.min[2]]);
  return { fixture: fix.add(flange), latch, span, pinD: D.latchPinD, mode: D.latchPinMode };
}
/**
 * Construye las probetas del plan, colocadas en una placa compacta.
 * @returns { parts, info: { volume, grams, minutes, size } }
 */
export function buildCalibration(P, plan) {
  try {
    const D = derive({ ...P, quality: 'final' });
    const lw = D.lw ?? P.lineWidth ?? 0.45, lh = D.lh ?? P.layerH ?? 0.2;
    const G = {
      seg: 64, lh,
      wallMin: 2 * lw + 0.3,
      ft: Math.max(1.0, Math.round(1.0 / lh) * lh),       // espesor de la pestaña de números
      emb: Math.max(0.4, 2 * lh),                          // relieve de 2 capas
      th: 4.2, ts: Math.max(0.8, 2 * lw),                  // alto y trazo de los números
      depth: 6.0,
    };
    const items = [];
    const pinFor = (Dx, span, pinD, clr, id, label) => {
      const pin = printedPin({ ...Dx, seg: G.seg }, span, pinD, clr);
      items.push({ id, name: label, man: pin.solid });
    };
    for (const t of plan.tests) {
      if (t.piece === 'hinge') {
        items.push({ id: 'cal' + t.id, name: `${t.id} · ${t.key}`, label: t.label, man: hingeBar(t, G) });
        if (t.mode === 'printed') pinFor(D, t.len + 0.2, t.pinD, t.variants[2]?.value ?? 0.25, 'cal' + t.id + 'pin', `${t.id} · pasador de prueba Ø${t.pinD}`);
      } else if (t.piece === 'tilted') {
        items.push({ id: 'calF', name: `F · ${t.key}`, label: t.label, man: tiltedBar(t, G) });
      } else if (t.piece === 'bore') {
        items.push({ id: 'calB', name: `B · ${t.key}`, label: t.label, man: borePlate(t, G, D) });
        if (t.mode === 'printed') pinFor(D, t.len + 0.2, t.pinD, t.variants[2]?.value ?? 0.25, 'calBpin', `B · pasador de prueba Ø${t.pinD}`);
      } else if (t.piece === 'tongue') {
        items.push({ id: 'calC', name: 'C · ranuras', man: grooveBlock(t, G) });
        items.push({ id: 'calCt', name: 'C · lengüeta', man: tonguePiece(t, G) });
      } else if (t.piece === 'stack') {
        const s = stackPieces(t, G, P.stackClr ?? 0.3);
        items.push({ id: 'calD', name: 'd · marcos de apilado', man: s.frames });
        items.push({ id: 'calDb', name: 'd · pieza base', man: s.cap });
      } else if (t.piece === 'latch') {
        const Dr = plan.mode === 'universal' ? derive({ ...refBox(P), quality: 'final' }) : D;
        const f = latchFixture(t, G, Dr);
        items.push({ id: 'calE', name: 'E · útil del cierre (boca abajo)', man: f.fixture });
        items.push({ id: 'calEl', name: 'E · cierre de prueba', man: f.latch });
        if (f.mode === 'printed') pinFor(Dr, f.span + 0.2, f.pinD, Dr.clrL, 'calEpin', `E · pasador de prueba Ø${f.pinD}`);
      }
    }
    // Colocación: filas de izquierda a derecha (piezas grandes primero),
    // 4 mm entre piezas, dentro de la cama.
    const gap = 4, maxW = Math.min((P.bedX || 220) - 10, 210);
    const sized = items.map((it) => ({ ...it, bb: it.man.boundingBox() }));
    sized.sort((a, b) => (b.bb.max[0] - b.bb.min[0]) - (a.bb.max[0] - a.bb.min[0]));
    let x = 0, y = 0, rowH = 0;
    const parts = [];
    let volume = 0, zMax = 0, printed = 0;
    for (const it of sized) {
      const bb = it.bb;
      const w = bb.max[0] - bb.min[0], h = bb.max[1] - bb.min[1];
      if (x > 0 && x + w > maxW) { x = 0; y += rowH + gap; rowH = 0; }
      const m = it.man.translate([x - bb.min[0], y - bb.min[1], -bb.min[2]]);
      x += w + gap; rowH = Math.max(rowH, h);
      zMax = Math.max(zMax, bb.max[2] - bb.min[2]);
      const vol = m.volume();
      volume += vol;
      // Material real con los ajustes de la caja (2 perímetros, 4 capas
      // arriba/abajo, relleno 15 %): cáscara ≈ área × 2 líneas, resto al 15 %.
      const mm = it.man.getMesh();
      let area = 0;
      const vp = mm.vertProperties, np = mm.numProp, tv = mm.triVerts;
      for (let k = 0; k < tv.length; k += 3) {
        const a = tv[k] * np, b2 = tv[k + 1] * np, c = tv[k + 2] * np;
        const ux = vp[b2] - vp[a], uy = vp[b2 + 1] - vp[a + 1], uz = vp[b2 + 2] - vp[a + 2];
        const wx = vp[c] - vp[a], wy = vp[c + 1] - vp[a + 1], wz = vp[c + 2] - vp[a + 2];
        area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
      }
      const shell = Math.min(vol, area * 2 * lw);
      printed += shell + 0.15 * (vol - shell);
      parts.push({
        id: it.id, key: it.id, name: it.name, mesh: toMesh(m, true),
        status: String(m.status()?.value ?? m.status()), components: m.decompose().length,
        tris: m.numTri(), volume: Math.round(vol), bbox: m.boundingBox(),
        print: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], instances: [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
        qty: 1, material: 'el de la caja', aids: [],
      });
    }
    // Tiempo ≈ caudal medio de 5 mm³/s (perímetros finos) + ~2 s por capa.
    const grams = (printed / 1000) * 1.24;
    const minutes = printed / 5 / 60 + (zMax / lh) * 2 / 60 + 2;
    const all = parts.map((p) => p.bbox);
    const size = [Math.max(...all.map((b) => b.max[0])), Math.max(...all.map((b) => b.max[1]))].map((v) => Math.round(v));
    return {
      parts, calib: true,
      info: { volume: Math.round(volume), grams: Math.round(grams * 10) / 10, minutes: Math.round(minutes), size, height: r3(zMax) },
      // Lo mínimo que el visor espera de un resultado del motor.
      D: { Hl: 0, Db: 0, Lband: 0, warn: [], log: [], inner: {} },
      assembly: { hinge: { y: 0, z: 0 }, latch: { y: 0, z: 0 }, z0: 0, rot90: false },
      ms: 0,
    };
  } finally {
    cleanup();
  }
}
