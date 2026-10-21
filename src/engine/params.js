/**
 * params.js — Parámetros de usuario, esquema de la interfaz y derivación de
 * todas las cotas internas de la caja.
 *
 * Filosofía:
 *   - El usuario define el ESPACIO ÚTIL INTERIOR de la base y de la tapa (lo
 *     que importa para los insertos). Todo lo exterior se calcula a partir de él.
 *   - `derive()` es una función pura: devuelve un objeto `D` con TODAS las
 *     cotas finales. La geometría solo lee de `D`; la interfaz muestra
 *     exactamente las mismas cifras con las que se modela.
 *   - Marco interno: X = lado LARGO (bisagras detrás, cierres delante). Si el
 *     usuario pide un ancho mayor que el largo, se modela girado y `D.rot90`
 *     indica al visor/exportador que lo devuelva a su orientación.
 *
 * Unidades: milímetros y grados.
 */

/* ------------------------------------------------------------------------ */
/*  Valores por defecto                                                     */
/* ------------------------------------------------------------------------ */

export const DEFAULTS = {
  // --- Espacio interior útil ---
  innerL: 120,          // largo interior
  innerW: 80,           // ancho interior
  baseDepth: 35,        // profundidad interior de la base
  lidDepth: 15,         // profundidad interior de la tapa
  lidMin: false,        // tapa lo más plana posible (objetos a ras del borde)
  innerR: 3,            // radio de las esquinas interiores (inner_corner_radius)

  // --- Pared y fondos ---
  wall: 2.7,            // espesor de pared (6 líneas de 0.45 mm)
  floor: 2.0,           // espesor del fondo de la base
  top: 2.0,             // espesor del techo de la tapa
  bandH: 5,             // altura mínima de la banda de unión
  bandProud: 0,         // vuelo de la banda sobre la pared (0 = automático)
  cornerRibs: true,     // nervios/parachoques verticales en las esquinas

  // --- Mecánica ---
  sizeClass: 'auto',    // 'auto' | 'S' | 'M' | 'L'
  pinMode: 'auto',      // 'auto' | 'filament' | 'printed'
  clearance: 0.25,      // holgura radial de ajuste
  axialGap: 0.4,        // holgura axial entre nudillos/orejetas
  hingeCount: 0,        // 0 = automático
  latchCount: 0,        // 0 = automático

  // --- Cierre hermético ---
  sealMode: 'tpu',      // 'tpu' | 'labyrinth' | 'simple'
  gasketCompression: 0.25,

  // --- Anti línea de contracción ---
  floorChamfer: 2.4,    // chaflán interior 45° suelo/pared y techo/pared
  shadowLine: true,     // ranuras de sombra en las alturas críticas
  snapToPrinter: true,  // ajustar cotas a capas y anchos de extrusión enteros
  lineWidth: 0.45,      // ancho de extrusión de las paredes
  layerH: 0.2,          // altura de capa

  // --- Ecosistema ---
  gridfinity: 'off',    // 'off' | 'baseplate' (bins dentro) | 'feet' (caja sobre placa)
  stackable: false,     // apilable: la base de una encaja sobre la tapa de otra

  // --- Tapa artística ---
  pattern: 'hex',       // 'smooth' | 'hex' | 'stripes' | 'cross' | 'circuit' | 'radial'
  relief: 'engrave',    // 'engrave' (grabado) | 'emboss' (relieve)
  patternDepth: 0.8,
  patternSize: 12,
  patternRib: 1.6,
  patternMargin: 5,
  stripeAngle: 45,
  patternSeed: 7,       // semilla del patrón "circuito"
  svgSize: 60,
  svgRotate: 0,
  svgOffsetX: 0,
  svgOffsetY: 0,

  // --- Impresora ---
  bedPreset: 'ad5m',
  bedX: 220,
  bedY: 220,
  bedZ: 220,
  printAids: 'auto',    // 'auto' | 'off': orejas anti‑warping y cuna de soporte

  // --- Calidad ---
  quality: 'preview',
};

/** Parámetros antiguos → nuevos (para enlaces y localStorage previos). */
export function migrate(saved) {
  const s = { ...saved };
  if (s.innerH !== undefined && s.baseDepth === undefined) {
    const f = s.lidFrac ?? 0.3;
    s.baseDepth = Math.round(s.innerH * (1 - f));
    s.lidDepth = Math.round(s.innerH * f);
  }
  if (s.gridfinity === true) s.gridfinity = 'feet';
  if (s.gridfinity === false) s.gridfinity = 'off';
  delete s.innerH; delete s.lidFrac;
  return s;
}

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
/*  Esquema de la interfaz (la UI se genera automáticamente)                */
/* ------------------------------------------------------------------------ */

export const SCHEMA = [
  { group: 'Espacio interior', items: [
    { k: 'innerL', label: 'Largo interior', type: 'range', min: 20, max: 400, step: 0.5, unit: 'mm' },
    { k: 'innerW', label: 'Ancho interior', type: 'range', min: 20, max: 400, step: 0.5, unit: 'mm' },
    { k: 'baseDepth', label: 'Profundidad base', type: 'range', min: 5, max: 250, step: 0.5, unit: 'mm' },
    { k: 'lidDepth', label: 'Profundidad tapa', type: 'range', min: 0, max: 120, step: 0.5, unit: 'mm' },
    { k: 'lidMin', label: 'Tapa mínima (objetos a ras)', type: 'toggle' },
    { k: 'innerR', label: 'Radio esquina interior', type: 'range', min: 0.5, max: 20, step: 0.5, unit: 'mm' },
  ]},
  { group: 'Estructura', items: [
    { k: 'wall', label: 'Espesor de pared', type: 'range', min: 1.2, max: 5, step: 0.05, unit: 'mm' },
    { k: 'floor', label: 'Espesor de fondo', type: 'range', min: 1.2, max: 5, step: 0.1, unit: 'mm' },
    { k: 'top', label: 'Espesor de techo', type: 'range', min: 1.2, max: 5, step: 0.1, unit: 'mm' },
    { k: 'bandH', label: 'Altura banda', type: 'range', min: 3, max: 12, step: 0.5, unit: 'mm' },
    { k: 'bandProud', label: 'Vuelo banda (0 = auto)', type: 'range', min: 0, max: 8, step: 0.1, unit: 'mm' },
    { k: 'cornerRibs', label: 'Nervios de esquina', type: 'toggle' },
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
    { k: 'floorChamfer', label: 'Chaflán interior 45°', type: 'range', min: 0, max: 8, step: 0.2, unit: 'mm' },
    { k: 'shadowLine', label: 'Ranuras de sombra automáticas', type: 'toggle' },
    { k: 'snapToPrinter', label: 'Ajustar a capas/extrusión', type: 'toggle' },
    { k: 'lineWidth', label: 'Ancho de extrusión', type: 'range', min: 0.3, max: 0.8, step: 0.01, unit: 'mm' },
    { k: 'layerH', label: 'Altura de capa', type: 'range', min: 0.08, max: 0.32, step: 0.02, unit: 'mm' },
  ]},
  { group: 'Tapa', items: [
    { k: 'pattern', label: 'Patrón', type: 'select', options: [
      ['smooth', 'Liso'], ['hex', 'Hexagonal'], ['stripes', 'Estriado'], ['cross', 'Reforzado cruzado'],
      ['circuit', 'Sci‑fi: circuito'], ['radial', 'Sci‑fi: radial']] },
    { k: 'relief', label: 'Modo', type: 'select', options: [
      ['engrave', 'Grabado (recomendado)'], ['emboss', 'Relieve']] },
    { k: 'patternDepth', label: 'Profundidad', type: 'range', min: 0.4, max: 2, step: 0.1, unit: 'mm' },
    { k: 'patternSize', label: 'Tamaño de celda / paso', type: 'range', min: 4, max: 40, step: 0.5, unit: 'mm' },
    { k: 'patternRib', label: 'Nervio / trazo', type: 'range', min: 0.8, max: 5, step: 0.1, unit: 'mm' },
    { k: 'patternMargin', label: 'Margen', type: 'range', min: 2, max: 20, step: 0.5, unit: 'mm' },
    { k: 'stripeAngle', label: 'Ángulo estriado', type: 'range', min: 0, max: 180, step: 5, unit: '°' },
    { k: 'patternSeed', label: 'Semilla circuito', type: 'range', min: 1, max: 999, step: 1, unit: '' },
  ]},
  { group: 'Logo SVG', svg: true, items: [
    { k: 'svgSize', label: 'Tamaño', type: 'range', min: 5, max: 100, step: 1, unit: '%' },
    { k: 'svgRotate', label: 'Rotación', type: 'range', min: -180, max: 180, step: 1, unit: '°' },
    { k: 'svgOffsetX', label: 'Desplazamiento X', type: 'range', min: -150, max: 150, step: 0.5, unit: 'mm' },
    { k: 'svgOffsetY', label: 'Desplazamiento Y', type: 'range', min: -150, max: 150, step: 0.5, unit: 'mm' },
  ]},
  { group: 'Ecosistema', gridfinity: true, items: [
    { k: 'gridfinity', label: 'Gridfinity', type: 'select', options: [
      ['off', 'Desactivado'], ['baseplate', 'Placa base interior (bins dentro)'], ['feet', 'Pies (caja sobre placa)']] },
    { k: 'stackable', label: 'Apilable', type: 'toggle' },
  ]},
  { group: 'Impresora', items: [
    { k: 'bedPreset', label: 'Modelo', type: 'select',
      options: Object.entries(BED_PRESETS).map(([k, v]) => [k, v.name]) },
    { k: 'bedX', label: 'Cama X', type: 'range', min: 100, max: 500, step: 1, unit: 'mm' },
    { k: 'bedY', label: 'Cama Y', type: 'range', min: 100, max: 500, step: 1, unit: 'mm' },
    { k: 'bedZ', label: 'Altura Z', type: 'range', min: 100, max: 500, step: 1, unit: 'mm' },
    { k: 'printAids', label: 'Ayudas de adherencia', type: 'select', options: [
      ['auto', 'Automáticas (orejas / cuna)'], ['off', 'Desactivadas']] },
  ]},
];

/* ------------------------------------------------------------------------ */
/*  Tabla de mecánica adaptativa                                            */
/* ------------------------------------------------------------------------ */

/**
 * Por clase de tamaño.
 *  - Bisagra S: filamento 1.75 mm (extruido continuo, sin uniones entre capas,
 *    ~3× más resistente a flexión que un pasador impreso del mismo Ø).
 *  - Bisagra M/L: pasador impreso ACOSTADO (capas a lo largo del eje).
 *  - Cierre: pasador propio más fino (lleva menos carga que la bisagra) para
 *    que el barril quepa dentro de la carcasa y el cierre sea corto.
 *  - Vuelo de banda pequeño: la banda solo aloja la junta; los bloques de
 *    cierre y bisagra son refuerzos locales (proporción "maletín").
 */
const MECH = {
  S: { pinD: 3.0, latchPin: 'filament', latchPinD: 3.0, plate: 2.0, latchW: 10, cheek: 3.0, kth: 2.0, bo: 2.4, hinges: 1, latches: 1 },
  M: { pinD: 3.5, latchPin: 'printed', latchPinD: 3.0, plate: 2.4, latchW: 14, cheek: 3.5, kth: 2.4, bo: 3.0, hinges: 2, latches: 2 },
  L: { pinD: 5.0, latchPin: 'printed', latchPinD: 3.5, plate: 3.0, latchW: 20, cheek: 4.5, kth: 3.0, bo: 3.6, hinges: 2, latches: 2 },
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
  const D = { warn, snapped: [] };

  /* ---- Ajuste a la impresora (frente 2 contra la línea de contracción) ---- */
  // Paredes = número entero de líneas de extrusión: el slicer las imprime
  // solo como perímetros, sin relleno ni "gap fill" pegado al perímetro
  // exterior, que es lo que transmite la contracción del relleno macizo a la
  // superficie visible. Espesores horizontales = número entero de capas.
  const lw = P.lineWidth, lh = P.layerH;
  const snapW = (v) => (P.snapToPrinter ? Math.max(3, Math.round(v / lw)) * lw : v);
  const snapH = (v) => (P.snapToPrinter ? Math.max(1, Math.round(v / lh)) * lh : v);
  const note = (name, a, b) => { if (Math.abs(a - b) > 1e-6) D.snapped.push(`${name} ${r2(a)} → ${r2(b)} mm`); };
  D.lw = lw; D.lh = lh;

  /* ---- Orientación: mecánica siempre en el lado largo ---- */
  D.rot90 = P.innerW > P.innerL;
  D.Li = D.rot90 ? P.innerW : P.innerL;
  D.Wi = D.rot90 ? P.innerL : P.innerW;

  D.t = r2(snapW(P.wall)); note('Pared', P.wall, D.t);
  D.ri = clamp(P.innerR, 0.5, Math.min(D.Li, D.Wi) / 2 - 0.5);
  D.ro = D.ri + D.t;
  D.Lo = D.Li + 2 * D.t;
  D.Wo = D.Wi + 2 * D.t;

  /* ---- Clase de tamaño ---- */
  const maxDim = Math.max(D.Lo, D.Wo);
  D.cls = P.sizeClass !== 'auto' ? P.sizeClass : maxDim < 90 ? 'S' : maxDim < 200 ? 'M' : 'L';
  const Mx = MECH[D.cls];
  D.pinMode = P.pinMode !== 'auto' ? P.pinMode : D.cls === 'S' ? 'filament' : 'printed';
  D.clr = P.clearance;
  D.ag = P.axialGap;

  // Bisagra
  if (D.pinMode === 'filament') { D.pinD = 1.75; D.holeD = 2.0; }
  else { D.pinD = Mx.pinD; D.holeD = r2(Mx.pinD + 2 * D.clr); }
  D.capHoleD = 1.70;
  D.rk = r2(D.holeD / 2 + Math.max(2.2, D.pinD * 0.55));

  // Cierre (pasador propio)
  D.latchPinMode = P.pinMode === 'filament' ? 'filament' : P.pinMode === 'printed' ? 'printed' : Mx.latchPin;
  if (D.latchPinMode === 'filament') { D.latchPinD = 1.75; D.latchHoleD = 2.0; }
  else { D.latchPinD = Mx.latchPinD; D.latchHoleD = r2(Mx.latchPinD + 2 * D.clr); }
  D.rl = r2(D.latchHoleD / 2 + Math.max(1.6, D.latchPinD * 0.45));

  /* ---- Banda ---- */
  D.bo = r2(P.bandProud > 0 ? P.bandProud : Mx.bo);
  D.F = r2(D.t + D.bo);              // ancho de la cara de unión

  /* ---- Sellado ---- */
  D.sealMode = P.sealMode;
  D.tl = 2.4;                        // longitud de la lengüeta
  if (D.sealMode === 'tpu') {
    // Juntas estáticas: compresión 20–30 % y llenado del alojamiento ≤ 85 %
    // (elastómero casi incompresible): gkw ≤ 0.85·gw·(1−c).
    D.c = clamp(P.gasketCompression, 0.15, 0.35);
    D.gw = r2(clamp(0.48 * D.F, 2.4, 4.0));
    D.gkw = r2(Math.max(1.3, 0.85 * D.gw * (1 - D.c) * 0.95));
    D.gkh = r2(snapH(1.8));
    D.gap = r2(D.gkh * (1 - D.c));
    D.gd = r2(D.tl + D.gap);
    D.fill = r2((D.gkw * D.gkh) / (D.gw * D.gap));
    D.grooves = [{ off: D.F / 2, w: D.gw }];
  } else if (D.sealMode === 'labyrinth') {
    const gw2 = r2(clamp((D.F - 3 * 1.0) / 2, 1.2, 3.0));
    D.gw = gw2;
    D.gd = r2(D.tl + 0.5);
    D.grooves = [{ off: 1.0 + gw2 / 2, w: gw2 }, { off: D.F - 1.0 - gw2 / 2, w: gw2 }];
  } else {
    D.gw = r2(clamp(0.45 * D.F, 2.0, 3.6));
    D.gd = r2(D.tl + 0.5);
    D.grooves = [{ off: D.F / 2, w: D.gw }];
  }
  D.tw = r2(D.gw - 2 * D.clr);
  D.bandH = r2(snapH(Math.max(P.bandH, D.gd + 1.5)));

  /* ---- Cierre empotrado (sección en s = distancia hacia fuera) ----
   *  sw: cara de la pared · sb: cara de la banda · sp: eje del cierre
   *  skt: punta del retén · spi/sh: caras interior/exterior de la placa
   *  Condición de autobloqueo: el centro del contacto gancho‑retén queda
   *  FUERA del eje (s mayor) → la reacción de la junta cierra el cierre.  */
  D.lt = Mx.plate;
  D.kth = Mx.kth;
  D.kc = 0.6;
  D.pre = 0.15;
  D.cheekW = Mx.cheek;
  D.sw = D.Wi / 2 + D.t;
  D.sb = D.sw + D.bo;
  D.sp = r2(D.sw + 0.6 + D.rl);
  D.skt = r2(Math.max(D.sb + 1.6, 2 * (D.sp + 0.4) - D.sb - 0.3 + D.kc));
  D.kd = r2(D.skt - D.sb);
  D.spi = r2(D.skt + 0.4);
  D.sh = r2(D.spi + D.lt);
  D.hh = Math.max(2.0, D.lt);
  // y en el marco interno (frente = −Y)
  D.yw = -D.sw; D.yfb = -D.sb; D.yp = -D.sp;

  /* ---- Anti hull‑line ---- */
  D.fc = r2(snapH(clamp(P.floorChamfer, 0, Math.min(D.Li, D.Wi) / 4)));
  if (P.floorChamfer === 0) D.fc = 0;
  D.shadow = !!P.shadowLine;
  D.shadowV = 0.5;

  /* ---- Tapa artística / apilado ---- */
  D.pattern = P.pattern;
  D.relief = P.relief;
  D.pd = P.patternDepth;
  D.stack = !!P.stackable;
  D.hs = 2.0;                        // altura del marco de apilado
  D.fw = 3.0;                        // ancho del marco de apilado
  D.sclr = 0.3;                      // holgura de apilado
  const engr = !D.stack && P.relief === 'engrave' && P.pattern !== 'smooth';
  D.topT = r2(snapH(engr ? Math.max(P.top, D.pd + 1.2) : P.top));
  D.floor = r2(snapH(P.floor)); note('Fondo', P.floor, D.floor);

  /* ---- Gridfinity ---- */
  D.gfMode = P.gridfinity;
  D.gfFeet = D.gfMode === 'feet' && !D.stack;
  if (D.gfMode === 'feet' && D.stack) warn.push('Apilable y pies Gridfinity son incompatibles: se omiten los pies.');
  D.gfH = 4.75;                      // altura de los pies
  D.gbH = 4.65;                      // altura de la placa base interior
  D.gfNx = Math.floor((D.gfMode === 'feet' ? D.Lo : D.Li) / 42 + 1e-6);
  D.gfNy = Math.floor((D.gfMode === 'feet' ? D.Wo : D.Wi) / 42 + 1e-6);
  if (D.gfMode !== 'off' && (D.gfNx < 1 || D.gfNy < 1)) {
    warn.push('La caja es menor que una celda Gridfinity (42 mm): Gridfinity omitido.');
    D.gfMode = 'off'; D.gfFeet = false;
  }
  D.gfPlate = D.gfMode === 'baseplate';
  D.floorTop = r2(D.floor + (D.gfPlate ? D.gbH : 0));   // suelo útil

  /* ---- Alturas ---- */
  // Base: el barril del cierre va bajo el fondo de la ranura; se necesita
  // sitio para él y su orejeta.
  const latchNeed = D.gd + 1.0 + 2 * D.rl + 0.8;
  const DbMin = r2(Math.max(latchNeed - D.floorTop, D.fc + 2, 5));
  let Db = P.baseDepth;
  if (Db < DbMin) { warn.push(`Base demasiado baja para los cierres: profundidad ajustada a ${DbMin} mm.`); Db = DbMin; }
  D.Hb = r2(snapH(D.floorTop + Db));
  D.Db = r2(D.Hb - D.floorTop);

  // Tapa: banda + retén. Altura mínima para alojar el retén y la carcasa.
  D.bandHl = r2(snapH(Math.max(3.0, D.kth + 1.0)));
  const HlMin = r2(D.bandHl + 1.6);
  const DlMin = r2(Math.max(0, HlMin - D.topT));
  let Dl = P.lidMin ? DlMin : P.lidDepth;
  if (Dl < DlMin) { if (!P.lidMin) warn.push(`Tapa ajustada a su mínimo mecánico: ${DlMin} mm.`); Dl = DlMin; }
  D.Hl = r2(snapH(D.topT + Dl));
  D.Dl = r2(D.Hl - D.topT);
  D.lidMin = DlMin;
  D.fcl = r2(Math.max(0, Math.min(D.fc, D.Dl - 0.4)));  // chaflán interior de la tapa

  /* ---- Cierre: alturas ---- */
  D.zp = r2(D.Hb - D.gd - 1.0 - D.rl);       // eje del barril
  D.zkt = r2(D.Hb + D.bandHl);               // cara superior del retén
  D.zc = r2(D.zkt - D.pre);                  // cara de agarre del gancho

  /* ---- Bisagra ---- */
  D.hGap = 0.5;
  D.yb = D.Wi / 2 + D.F;                     // cara trasera de la banda
  D.ya = r2(D.yb + D.hGap + D.rk);
  // Eje a la altura de la PUNTA de la lengüeta: al abrir, la lengüeta sale
  // casi vertical de la ranura (cinemática en hinge.js).
  D.za = r2(D.Hb - D.tl);
  D.Lband = D.Li + 2 * D.F;
  D.Wband = D.Wi + 2 * D.F;

  /* ---- Nervios de esquina ---- */
  D.ribs = !!P.cornerRibs;
  D.cw = r2(clamp(0.08 * Math.min(D.Lo, D.Wo) + 4, 5, 12));   // tramo recto del nervio

  /* ---- Reparto en el lado largo (adaptado a la longitud disponible) ---- */
  const endMargin = D.ro + (D.ribs ? D.cw : 0) + 2;
  const avail = D.Lo - 2 * endMargin;

  // Bisagras
  let nH = P.hingeCount > 0 ? P.hingeCount : D.Lo > 300 ? 3 : Mx.hinges;
  let Lh = nH === 1 ? Math.min(0.6 * D.Lo, 70) : clamp(0.22 * D.Lo, 26, 60);
  while (nH > 1 && nH * Lh + (nH - 1) * 8 > avail) nH--;
  Lh = Math.min(Lh, (avail - 8 * (nH - 1)) / nH);
  let nk = Lh >= 34 ? 5 : 3;
  let kl = (Lh - (nk - 1) * D.ag) / nk;
  if (kl < 4 && nk > 3) { nk = 3; kl = (Lh - 2 * D.ag) / 3; }
  if (kl < 3) warn.push('Bisagras muy cortas para este largo: considera la clase S o reducir el número.');
  D.hinge = { n: nH, len: r2(Lh), nk, kl: r2(kl), xs: spread(nH, avail, Lh) };

  // Cierres
  let nL = P.latchCount > 0 ? P.latchCount : D.Lo > 300 ? 3 : Mx.latches;
  D.latchW = Mx.latchW;
  let span = D.latchW + 2 * (D.ag + D.cheekW);
  while (nL > 1 && nL * span + (nL - 1) * 10 > avail) nL--;
  if (span > avail) {
    D.latchW = r2(Math.max(6, avail - 2 * (D.ag + D.cheekW)));
    span = D.latchW + 2 * (D.ag + D.cheekW);
    if (span > avail) warn.push('El lado largo es demasiado corto para un cierre completo.');
  }
  D.latch = { n: nL, span: r2(span), xs: spread(nL, avail, span) };

  /* ---- Pies Gridfinity / origen vertical ---- */
  D.z0 = D.gfFeet ? D.gfH : 0;

  /* ---- Medidas exteriores (en orientación del usuario) ---- */
  const extL = r2(D.Lband);
  const extW = r2(D.ya + D.rk + D.sh + 1.2);
  D.outerL = D.rot90 ? extW : extL;
  D.outerW = D.rot90 ? extL : extW;
  D.outerH = r2(D.z0 + D.Hb + D.Hl + (D.stack ? D.hs : D.relief === 'emboss' ? D.pd : 0));

  /* ---- Medidas para diseñar insertos (orientación del usuario) ---- */
  D.inner = {
    L: r2(P.innerL), W: r2(P.innerW),
    inner_corner_radius: r2(D.ri),
    baseDepth: r2(D.Db),
    lidDepth: r2(D.Dl),
    closedHeight: r2(D.Db + D.Dl),
    floorChamfer: r2(D.fc),
    lidChamfer: r2(D.fcl),
  };
  if (D.gfPlate) {
    const free = D.Db + D.Dl;
    D.inner.gridfinity = { nx: D.rot90 ? D.gfNy : D.gfNx, ny: D.rot90 ? D.gfNx : D.gfNy,
      freeHeight: r2(free), units: Math.floor((free - 0.5) / 7) };
  }

  D.seg = P.quality === 'final' ? 96 : 40;
  return D;
}

/** Reparte n elementos de longitud `len` dentro de `avail`, centrados. */
function spread(n, avail, len) {
  if (n <= 1) return [0];
  const half = Math.max(0, (avail - len) / 2);
  const edge = Math.min(half, Math.max(len / 2 + 4, avail * 0.32));
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(r2(-edge + (2 * edge * i) / (n - 1)));
  return xs;
}
