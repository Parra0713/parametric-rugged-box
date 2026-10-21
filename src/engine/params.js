/**
 * params.js — Parámetros de usuario, esquema de la interfaz y derivación de
 * todas las cotas internas de la caja.
 *
 * Filosofía:
 *   - El usuario define el ESPACIO ÚTIL INTERIOR (lo que le importa para los
 *     insertos). Todo lo exterior se calcula a partir de él.
 *   - `derive()` es una función pura: recibe los parámetros y devuelve un
 *     objeto `D` con TODAS las cotas finales. La geometría (box.js, hinge.js…)
 *     solo lee de `D`, nunca recalcula. Así la interfaz puede mostrar
 *     exactamente las mismas cifras que se usan para modelar.
 *
 * Unidades: milímetros y grados.
 */

/* ------------------------------------------------------------------------ */
/*  Valores por defecto                                                     */
/* ------------------------------------------------------------------------ */

export const DEFAULTS = {
  // --- Espacio interior útil ---
  innerL: 120,          // largo interior (X)
  innerW: 80,           // ancho interior (Y)
  innerH: 50,           // alto interior total con la caja cerrada (base + tapa)
  lidFrac: 0.3,         // fracción del alto interior que pertenece a la tapa
  innerR: 3,            // radio de las esquinas interiores (inner_corner_radius)

  // --- Pared y fondos ---
  wall: 2.4,            // espesor de pared (6 perímetros con boquilla 0.4)
  floor: 2.0,           // espesor del fondo de la base
  top: 2.4,             // espesor del techo de la tapa
  bandH: 6,             // altura mínima de la banda perimetral (refuerzo)

  // --- Mecánica ---
  sizeClass: 'auto',    // 'auto' | 'S' | 'M' | 'L'
  pinMode: 'auto',      // 'auto' | 'filament' | 'printed'
  clearance: 0.25,      // holgura radial de ajuste (pasadores, lengüeta)
  axialGap: 0.4,        // holgura axial entre nudillos/orejetas
  hingeCount: 0,        // 0 = automático
  latchCount: 0,        // 0 = automático

  // --- Cierre hermético ---
  sealMode: 'tpu',      // 'tpu' | 'labyrinth' | 'simple'
  gasketCompression: 0.25, // compresión objetivo de la junta TPU (20–30 %)

  // --- Anti línea de contracción ("Benchy hull line") ---
  floorChamfer: 2.5,    // chaflán interior 45° suelo/pared (transición gradual)
  shadowLine: true,     // ranura en V exterior que oculta la transición

  // --- Ecosistema ---
  gridfinity: false,    // pies Gridfinity bajo la base (desactivado por defecto)

  // --- Tapa artística ---
  pattern: 'hex',       // 'smooth' | 'hex' | 'stripes' | 'cross'
  relief: 'engrave',    // 'engrave' (grabado) | 'emboss' (relieve)
  patternDepth: 0.8,    // profundidad/altura del patrón
  patternSize: 12,      // tamaño de celda / paso
  patternRib: 1.6,      // ancho de nervio entre celdas
  patternMargin: 5,     // margen desde el borde exterior de la tapa
  stripeAngle: 45,      // ángulo del estriado
  svgSize: 60,          // % del ancho útil que ocupa el SVG
  svgRotate: 0,
  svgOffsetX: 0,
  svgOffsetY: 0,

  // --- Impresora ---
  bedPreset: 'ad5m',
  bedX: 220,
  bedY: 220,
  bedZ: 220,

  // --- Calidad ---
  quality: 'preview',   // 'preview' | 'final'
};

/** Camas de impresión conocidas (X, Y, Z en mm). */
export const BED_PRESETS = {
  ad5m:   { name: 'FlashForge Adventurer 5M', x: 220, y: 220, z: 220 },
  a1mini: { name: 'Bambu Lab A1 mini',        x: 180, y: 180, z: 180 },
  x1:     { name: 'Bambu Lab X1/P1/A1',       x: 256, y: 256, z: 256 },
  mk4:    { name: 'Prusa MK4',                x: 250, y: 210, z: 220 },
  ender3: { name: 'Creality Ender 3',         x: 220, y: 220, z: 250 },
  k1max:  { name: 'Creality K1 Max',          x: 300, y: 300, z: 300 },
  custom: { name: 'Personalizada',            x: 220, y: 220, z: 220 },
};

/* ------------------------------------------------------------------------ */
/*  Esquema de la interfaz                                                  */
/*  Cada entrada describe un control. La UI se genera automáticamente.     */
/* ------------------------------------------------------------------------ */

export const SCHEMA = [
  { group: 'Espacio interior', items: [
    { k: 'innerL', label: 'Largo interior', type: 'range', min: 20, max: 400, step: 1, unit: 'mm' },
    { k: 'innerW', label: 'Ancho interior', type: 'range', min: 20, max: 400, step: 1, unit: 'mm' },
    { k: 'innerH', label: 'Alto interior total', type: 'range', min: 10, max: 250, step: 1, unit: 'mm' },
    { k: 'lidFrac', label: 'Fracción en la tapa', type: 'range', min: 0.1, max: 0.5, step: 0.01, unit: '' },
    { k: 'innerR', label: 'Radio esquina interior', type: 'range', min: 0.5, max: 20, step: 0.5, unit: 'mm' },
  ]},
  { group: 'Estructura', items: [
    { k: 'wall', label: 'Espesor de pared', type: 'range', min: 1.2, max: 5, step: 0.1, unit: 'mm' },
    { k: 'floor', label: 'Espesor de fondo', type: 'range', min: 1.2, max: 5, step: 0.1, unit: 'mm' },
    { k: 'top', label: 'Espesor de techo', type: 'range', min: 1.2, max: 5, step: 0.1, unit: 'mm' },
    { k: 'bandH', label: 'Altura banda', type: 'range', min: 4, max: 15, step: 0.5, unit: 'mm' },
  ]},
  { group: 'Mecánica', items: [
    { k: 'sizeClass', label: 'Clase de tamaño', type: 'select', options: [
      ['auto', 'Automática'], ['S', 'S — pequeña'], ['M', 'M — mediana'], ['L', 'L — grande']] },
    { k: 'pinMode', label: 'Pasadores', type: 'select', options: [
      ['auto', 'Automático'], ['filament', 'Filamento 1.75 mm'], ['printed', 'Impresos (snap)']] },
    { k: 'hingeCount', label: 'Bisagras (0 = auto)', type: 'range', min: 0, max: 4, step: 1, unit: '' },
    { k: 'latchCount', label: 'Cierres (0 = auto)', type: 'range', min: 0, max: 4, step: 1, unit: '' },
    { k: 'clearance', label: 'Holgura radial', type: 'range', min: 0.1, max: 0.5, step: 0.05, unit: 'mm' },
    { k: 'axialGap', label: 'Holgura axial', type: 'range', min: 0.2, max: 0.8, step: 0.05, unit: 'mm' },
  ]},
  { group: 'Sellado', items: [
    { k: 'sealMode', label: 'Tipo de cierre', type: 'select', options: [
      ['tpu', 'Junta TPU (hermético)'], ['labyrinth', 'Laberinto doble'], ['simple', 'Lengüeta simple']] },
    { k: 'gasketCompression', label: 'Compresión junta', type: 'range', min: 0.15, max: 0.35, step: 0.01, unit: '' },
  ]},
  { group: 'Anti línea de contracción', items: [
    { k: 'floorChamfer', label: 'Chaflán interior', type: 'range', min: 0, max: 8, step: 0.5, unit: 'mm' },
    { k: 'shadowLine', label: 'Ranura de sombra exterior', type: 'toggle' },
  ]},
  { group: 'Tapa', items: [
    { k: 'pattern', label: 'Patrón', type: 'select', options: [
      ['smooth', 'Liso'], ['hex', 'Hexagonal'], ['stripes', 'Estriado'], ['cross', 'Reforzado cruzado']] },
    { k: 'relief', label: 'Modo', type: 'select', options: [
      ['engrave', 'Grabado (recomendado)'], ['emboss', 'Relieve']] },
    { k: 'patternDepth', label: 'Profundidad', type: 'range', min: 0.4, max: 2, step: 0.1, unit: 'mm' },
    { k: 'patternSize', label: 'Tamaño de celda', type: 'range', min: 4, max: 40, step: 0.5, unit: 'mm' },
    { k: 'patternRib', label: 'Nervio', type: 'range', min: 0.8, max: 5, step: 0.1, unit: 'mm' },
    { k: 'patternMargin', label: 'Margen', type: 'range', min: 2, max: 20, step: 0.5, unit: 'mm' },
    { k: 'stripeAngle', label: 'Ángulo estriado', type: 'range', min: 0, max: 180, step: 5, unit: '°' },
  ]},
  { group: 'Logo SVG', svg: true, items: [
    { k: 'svgSize', label: 'Tamaño', type: 'range', min: 5, max: 100, step: 1, unit: '%' },
    { k: 'svgRotate', label: 'Rotación', type: 'range', min: -180, max: 180, step: 1, unit: '°' },
    { k: 'svgOffsetX', label: 'Desplazamiento X', type: 'range', min: -150, max: 150, step: 0.5, unit: 'mm' },
    { k: 'svgOffsetY', label: 'Desplazamiento Y', type: 'range', min: -150, max: 150, step: 0.5, unit: 'mm' },
  ]},
  { group: 'Ecosistema', items: [
    { k: 'gridfinity', label: 'Base Gridfinity', type: 'toggle' },
  ]},
  { group: 'Impresora', items: [
    { k: 'bedPreset', label: 'Modelo', type: 'select',
      options: Object.entries(BED_PRESETS).map(([k, v]) => [k, v.name]) },
    { k: 'bedX', label: 'Cama X', type: 'range', min: 100, max: 500, step: 1, unit: 'mm' },
    { k: 'bedY', label: 'Cama Y', type: 'range', min: 100, max: 500, step: 1, unit: 'mm' },
    { k: 'bedZ', label: 'Altura Z', type: 'range', min: 100, max: 500, step: 1, unit: 'mm' },
  ]},
];

/* ------------------------------------------------------------------------ */
/*  Tabla de mecánica adaptativa                                            */
/* ------------------------------------------------------------------------ */

/**
 * Por clase de tamaño. Justificación (resumen de la investigación):
 *  - S (< 90 mm): un pasador impreso < 3 mm es frágil (pocas capas y
 *    perímetros). Lo más robusto es un trozo de filamento 1.75 mm: es un
 *    extruido continuo, sin uniones entre capas, ~3× más resistente a flexión
 *    que un pasador impreso del mismo diámetro.
 *  - M/L: el pasador se imprime ACOSTADO (eje paralelo a la cama), de modo que
 *    las capas corren a lo largo del pasador. Impreso vertical, el plástico
 *    trabaja en el eje Z (unión entre capas, 40–60 % más débil) y se parte a
 *    cortante. Lleva una cara plana inferior (perfil "D") para apoyar sin
 *    soportes y una punta partida con dientes que se abren en el plano XY.
 */
const MECH = {
  S: { pinD: 3.0, plate: 2.4, latchW: 12, lug: 3.5, keeper: 1.8, keeperCh: 0.6, hinges: 1, latches: 1 },
  M: { pinD: 3.5, plate: 3.0, latchW: 18, lug: 4.5, keeper: 2.0, keeperCh: 0.8, hinges: 2, latches: 2 },
  L: { pinD: 5.0, plate: 3.6, latchW: 24, lug: 6.0, keeper: 2.4, keeperCh: 1.0, hinges: 2, latches: 2 },
};

/* ------------------------------------------------------------------------ */
/*  Derivación                                                              */
/* ------------------------------------------------------------------------ */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Calcula todas las cotas de la caja.
 * @param {object} P parámetros de usuario (DEFAULTS + cambios)
 * @returns {object} D cotas derivadas + avisos
 */
export function derive(P) {
  const warn = [];
  const D = { warn };

  /* ---- Interior y pared ---- */
  D.Li = P.innerL;
  D.Wi = P.innerW;
  D.t = P.wall;
  D.ri = clamp(P.innerR, 0.5, Math.min(D.Li, D.Wi) / 2 - 0.5);
  D.ro = D.ri + D.t;                 // radio exterior de la pared
  D.Lo = D.Li + 2 * D.t;             // largo exterior de pared
  D.Wo = D.Wi + 2 * D.t;

  /* ---- Clase de tamaño (mecánica adaptativa) ---- */
  const maxDim = Math.max(D.Lo, D.Wo);
  D.cls = P.sizeClass !== 'auto' ? P.sizeClass : maxDim < 90 ? 'S' : maxDim < 200 ? 'M' : 'L';
  const M = MECH[D.cls];
  D.pinMode = P.pinMode !== 'auto' ? P.pinMode : D.cls === 'S' ? 'filament' : 'printed';
  D.clr = P.clearance;
  D.ag = P.axialGap;

  if (D.pinMode === 'filament') {
    D.pinD = 1.75;
    D.holeD = 1.75 + 0.25;           // 2.0 mm: gira libre con la teardrop
    D.capHoleD = 1.70;               // tapón a presión en los extremos
  } else {
    D.pinD = M.pinD;
    D.holeD = M.pinD + 2 * D.clr;
  }
  // Radio de nudillo: ~2.2–3 mm de material alrededor del agujero
  // (≥ 5 perímetros de 0.45 mm) para que el anillo no se abra.
  D.rk = r2(D.holeD / 2 + Math.max(2.2, D.pinD * 0.55));
  // Vuelo de la banda: debe alojar el barril del cierre por DENTRO de la cara
  // de la banda (condición de auto‑bloqueo, ver latch.js).
  D.bo = r2(D.rk + 1.6);
  D.F = D.t + D.bo;                  // ancho de la cara de unión tapa/base

  /* ---- Sellado ---- */
  D.sealMode = P.sealMode;
  D.tl = 2.5;                        // longitud de la lengüeta
  if (D.sealMode === 'tpu') {
    // Ranura (gland) con junta TPU impresa.
    // Regla de diseño de juntas estáticas: compresión 20–30 % y llenado del
    // alojamiento ≤ 85 % (el elastómero es casi incompresible, ν≈0.48).
    // Llenado = (gkw·gkh)/(gw·gap) y gap = gkh·(1−c)  ⇒  gkw ≤ 0.85·gw·(1−c)
    D.c = clamp(P.gasketCompression, 0.15, 0.35);
    D.gw = r2(clamp(0.42 * D.F, 2.6, 4.0));
    D.gkw = r2(Math.max(1.4, 0.85 * D.gw * (1 - D.c) * 0.95));
    D.gkh = 2.0;                                   // 10 capas de 0.2 mm
    D.gap = r2(D.gkh * (1 - D.c));                 // altura libre con la caja cerrada
    D.gd = r2(D.tl + D.gap);                       // profundidad de ranura
    D.fill = r2((D.gkw * D.gkh) / (D.gw * D.gap));
    D.grooves = [{ off: D.F / 2, w: D.gw }];
  } else if (D.sealMode === 'labyrinth') {
    // Dos lengüetas concéntricas: el fluido debe cambiar 8 veces de dirección.
    const gw2 = r2(clamp((D.F - 3 * 1.2) / 2, 1.4, 3.0));
    D.gw = gw2;
    D.gd = r2(D.tl + 0.5);
    D.grooves = [
      { off: 1.2 + gw2 / 2, w: gw2 },
      { off: D.F - 1.2 - gw2 / 2, w: gw2 },
    ];
  } else {
    D.gw = r2(clamp(0.4 * D.F, 2.0, 3.6));
    D.gd = r2(D.tl + 0.5);
    D.grooves = [{ off: D.F / 2, w: D.gw }];
  }
  D.tw = r2(D.gw - 2 * D.clr);       // ancho de lengüeta en la raíz

  /* ---- Banda ---- */
  D.bandH = r2(Math.max(P.bandH, D.gd + 2.0));

  /* ---- Anti hull‑line ---- */
  D.fc = clamp(P.floorChamfer, 0, Math.min(D.Li, D.Wi) / 4);
  D.shadow = !!P.shadowLine;
  D.shadowV = 0.6;                   // profundidad de la ranura en V

  /* ---- Tapa artística ---- */
  D.pattern = P.pattern;
  D.relief = P.relief;
  D.pd = P.patternDepth;
  D.topT = P.relief === 'engrave' && P.pattern !== 'smooth'
    ? Math.max(P.top, D.pd + 1.2) : P.top;

  /* ---- Alturas ---- */
  // Altura mínima de la base para alojar: banda + chaflán de banda + orejetas
  // del cierre (con su chaflán de 45°) + fondo + chaflán interior.
  const latchBlock = D.bandH + D.bo + 0.6 + 2 * D.rk + 1.0;
  const DbMin = Math.ceil(Math.max(latchBlock - P.floor, D.fc + 4));
  let Db = Math.round(P.innerH * (1 - P.lidFrac) * 10) / 10;
  if (Db < DbMin) {
    warn.push(`Base demasiado baja para los cierres: profundidad ajustada a ${DbMin} mm.`);
    Db = DbMin;
  }
  let Dl = r2(P.innerH - Db);
  const DlMin = Math.ceil(D.fc + 2);
  if (Dl < DlMin) {
    warn.push(`Tapa demasiado baja: profundidad ajustada a ${DlMin} mm.`);
    Dl = DlMin;
  }
  D.Db = Db;
  D.Dl = Dl;
  D.floor = P.floor;
  D.Hb = r2(P.floor + Db);           // altura de la base (sin gridfinity)
  D.Hl = r2(D.topT + Dl);            // altura de la tapa
  D.bandHl = r2(Math.min(D.bandH, D.Hl - 1));

  /* ---- Bisagra ---- */
  D.hGap = 0.5;                                     // separación nudillo ↔ banda
  D.yb = D.Wi / 2 + D.t + D.bo;                     // cara trasera de la banda
  D.ya = r2(D.yb + D.hGap + D.rk);                  // eje de bisagra (Y)
  // Eje a la altura de la PUNTA de la lengüeta: al abrir, la lengüeta sale
  // verticalmente de la ranura sin rozar (análisis cinemático en hinge.js).
  D.za = r2(D.Hb - D.tl);
  D.Lband = D.Li + 2 * D.F;
  D.Wband = D.Wi + 2 * D.F;

  const nH = P.hingeCount > 0 ? P.hingeCount : D.Lo > 300 ? 3 : M.hinges;
  let Lh = nH === 1 ? Math.min(0.6 * D.Lo, 70) : clamp(0.22 * D.Lo, 26, 60);
  Lh = Math.min(Lh, (D.Lo - 2 * D.ro - 6 * (nH - 1)) / nH);
  let nk = Lh >= 34 ? 5 : 3;
  let kl = (Lh - (nk - 1) * D.ag) / nk;
  if (kl < 4 && nk > 3) { nk = 3; kl = (Lh - 2 * D.ag) / 3; }
  if (kl < 3) warn.push('Bisagras muy cortas: aumenta el largo de la caja o reduce su número.');
  D.hinge = { n: nH, len: r2(Lh), nk, kl: r2(kl), xs: spread(nH, D.Lo, Lh, D.ro) };

  /* ---- Cierres ---- */
  const nL = P.latchCount > 0 ? P.latchCount : D.Lo > 300 ? 3 : M.latches;
  D.lt = M.plate;                     // espesor de placa del cierre
  D.latchW = M.latchW;
  D.lugL = M.lug;
  D.kd = M.keeper;                    // vuelo del retén en la tapa
  D.kc = M.keeperCh;                  // chaflán del retén (rampa de entrada)
  D.rl = D.rk;                        // radio del barril del cierre
  D.yw = -(D.Wi / 2 + D.t);           // cara frontal de la pared
  D.yfb = -D.yb;                      // cara frontal de la banda
  D.yp = r2(D.yw - 0.6 - D.rl);       // eje del cierre (Y), por dentro de la banda
  D.zp = r2(D.Hb - D.bandH - D.bo - D.rl - 0.6);
  D.zkt = r2(D.Hb + D.bandHl);        // cara superior del retén (z mundo)
  D.pre = 0.15;                       // precarga del gancho
  D.ypi = r2(D.yfb - D.kd - 0.4);     // cara interior de la placa
  const latchSpan = D.latchW + 2 * (D.ag + D.lugL);
  D.latch = { n: nL, span: r2(latchSpan), xs: spread(nL, D.Lo, latchSpan, D.ro) };

  /* ---- Gridfinity ---- */
  D.gf = !!P.gridfinity;
  D.gfH = 4.75;
  D.gfNx = Math.floor((D.Lo + 0.01) / 42);
  D.gfNy = Math.floor((D.Wo + 0.01) / 42);
  if (D.gf && (D.gfNx < 1 || D.gfNy < 1)) {
    warn.push('La caja es menor que una celda Gridfinity (42 mm): pies omitidos.');
    D.gf = false;
  }
  D.z0 = D.gf ? D.gfH : 0;            // desplazamiento vertical del cuerpo

  /* ---- Medidas exteriores totales ---- */
  D.outerL = r2(D.Lband);
  D.outerW = r2(D.ya + D.rk - D.ypi + D.lt + 3);
  D.outerH = r2(D.z0 + D.Hb + D.Hl + (D.relief === 'emboss' ? D.pd : 0));

  /* ---- Medidas que expone la interfaz para diseñar insertos ---- */
  D.inner = {
    L: r2(D.Li), W: r2(D.Wi),
    inner_corner_radius: r2(D.ri),
    baseDepth: r2(D.Db),
    lidDepth: r2(D.Dl),
    closedHeight: r2(D.Db + D.Dl),
    floorChamfer: r2(D.fc),
    // El inserto debe tener un chaflán ≥ floorChamfer en sus aristas
    // inferiores, o despegarse del suelo esa altura.
  };

  /* ---- Calidad de teselado ---- */
  D.seg = P.quality === 'final' ? 96 : 40;
  return D;
}

/**
 * Reparte n elementos de longitud `len` a lo largo de una cara de longitud L,
 * evitando las esquinas redondeadas.
 */
function spread(n, L, len, r) {
  if (n <= 1) return [0];
  const usable = L / 2 - r - len / 2 - 4;
  const edge = Math.max(len / 2 + 2, Math.min(usable, L * 0.32));
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(r2(-edge + (2 * edge * i) / (n - 1)));
  return xs;
}
