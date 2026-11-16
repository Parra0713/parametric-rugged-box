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

import { orgBase, orgLayout, contentModes } from './orgLayout.js';

export { contentModes };

/** Versión de la aplicación (la misma que package.json; va en el LEEME y en el registro). */
export const VERSION = '7.3.1';

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
  cornerCut: 0,         // recorte de esquinas a 45° (octógono alargado), 0 = rectángulo

  // --- Ahorro de material ---
  eco: false,           // modo ahorro: mínimos seguros, misma mecánica y cierre
  ecoDesign: 'min',     // 'min' (mismo diseño, mínimos) | 'rib' (piel fina + nervios)

  // --- Pared y fondos ---
  wall: 2.7,            // espesor de pared (6 líneas de 0.45 mm)
  floor: 2.0,           // espesor del fondo de la base
  top: 2.0,             // espesor del techo de la tapa
  bandH: 5,             // altura mínima de la banda de unión
  bandProud: 0,         // vuelo de la banda sobre la pared (0 = automático)
  cornerRibs: true,     // nervios/parachoques verticales en las esquinas

  // --- Mecánica ---
  sizeClass: 'auto',    // 'auto' | 'XS' | 'S' | 'M' | 'L'
  pinMode: 'auto',      // 'auto' | 'filament' | 'printed'
  clearance: 0.25,      // holgura radial pasador impreso ↔ agujero horizontal (bisagra, orejetas), Ø ≤ 3
  clearanceL: 0.25,     // ídem para pasador grande Ø ≥ 5 (entre Ø3 y Ø5 se interpola)
  tiltAdd: 0,           // holgura extra por lado de los agujeros si la pieza se imprime inclinada
  latchPre: 0.15,       // precarga del gancho del cierre sobre el retén
  filClr: 0.125,        // holgura radial filamento 1.75 ↔ agujero horizontal (agujero 2.0)
  axialGap: 0.4,        // holgura axial entre nudillos/orejetas
  sealClr: 0.25,        // holgura por lado lengüeta ↔ ranura
  stackClr: 0.3,        // holgura de apilado (pie ↔ marco)
  hingeCount: 0,        // 0 = automático
  latchCount: 0,        // 0 = automático

  // --- Cierre hermético ---
  sealMode: 'tpu',      // 'tpu' (junta impresa) | 'cord' (cordón de filamento TPU 1.75) | 'labyrinth' | 'simple'
  gasketCompression: 0.25,

  // --- Anti línea de contracción ---
  floorChamfer: 2.4,    // chaflán interior 45° suelo/pared y techo/pared
  shadowLine: true,     // ranuras de sombra en las alturas críticas
  snapToPrinter: true,  // ajustar cotas a capas y anchos de extrusión enteros
  lineWidth: 0.45,      // ancho de extrusión de las paredes
  holeComp: 0.15,       // compensación de agujeros verticales en piezas sueltas (cierre, tapones)
  layerH: 0.2,          // altura de capa

  // --- Ecosistema ---
  gridfinity: 'off',    // 'off' | 'baseplate' (bins dentro) | 'feet' (caja sobre placa)
  stackable: false,     // apilable: la base de una encaja sobre la tapa de otra

  // --- Tapa artística ---
  pattern: 'hex',       // 'smooth' | 'hex' | 'stripes' | 'cross' | 'circuit' | 'radial'
  relief: 'engrave',    // 'engrave' (grabado) | 'emboss' (relieve)
  patternDepth: 0.8,
  patternSize: 11.5,    // celda de 9.9 mm: puente < 10 mm al imprimir boca abajo
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
  printAids: 'auto',    // 'auto' | 'off': orejas, bisel de contacto y aletas
  aidsInPart: true,     // incluir las ayudas en el STL de la pieza
  finSpacing: 0,        // separación entre aletas (0 = automática ≈ 40 mm)
  finReach: 0,          // alcance de las aletas en % del ancho (0 = hasta el centro de masa)
  toothPitch: 6,        // paso de los dientes de contacto
  finGap: 0,            // holgura aleta‑pieza (0 = 1.5 capas)

  // --- Contenido de cada mitad: 'off' | 'blank' | 'pockets' | 'org' ---
  // (cualquier combinación: inserto en la base y compartimentos en la tapa,
  //  compartimentos en las dos, inserto con huecos en la tapa…)
  insertMode: 'off',    // BASE: nada | inserto en blanco | inserto con huecos (contenido SVG) | compartimentos
  lidMode: 'off',       // TAPA: ídem

  // --- Compartimentos de la tapa ---
  orgCols: 6,           // columnas (a lo largo del lado largo)
  orgRows: 3,           // filas (lado corto)
  orgMinL: 0,           // largo mínimo de celda (0 = repartir el interior); la caja crece si hace falta
  orgMinW: 0,           // ancho mínimo de celda
  orgDepth: 0,          // altura de las celdas (0 = la que dé la tapa); la tapa crece si hace falta
  orgCover: 'single',   // 'single' | 'row' | 'cell' | 'none': tapas interiores
  orgScoop: true,       // fondo con chaflán para recoger piezas pequeñas

  // --- Compartimentos de la base (mismos ajustes, independientes) ---
  orgBCols: 3,
  orgBRows: 2,
  orgBMinL: 0,
  orgBMinW: 0,
  orgBDepth: 0,         // 0 = la que dé la base; la base crece si hace falta
  orgBCover: 'single',
  orgBScoop: true,

  // --- Traba de las tapas interiores ---
  orgLatch: 'snap',     // 'snap' (mecánica, clic) | 'magnet' (imanes de disco)
  magnetD: 6,           // diámetro del imán
  magnetH: 2, magnetCount: 0,           // altura del imán

  // --- Insertos interiores ---
  insertH: 0,           // altura del inserto de la base (0 = auto: profundidad de la base − 0.5)
  insertTol: 0.3,       // holgura inserto ↔ caja
  pocketTol: 0.6,       // holgura objeto ↔ alojamiento
  insertDeck: 1.6,      // espesor de la cubierta
  fingerCount: 'auto',  // 'auto' (2) | '0' | '1' | '2'
  fingerD: 20,          // diámetro del hueco para dedos
  fingerPos: 0,         // posición a lo largo del eje mayor del objeto (−100…100 %)

  // --- Soportes ---
  overhangSupports: true, // soportes automáticos en voladizos de partes salientes
  overhangAngle: 50,    // ángulo máximo de voladizo sin soporte
  maxBridge: 10,        // puente más largo sin soporte (Orca/Bambu: 10 mm por defecto)
  supportPitch: 3,      // paso de la rejilla de los soportes

  // --- Contenido (SVG calcado de la pieza real) ---
  objClearance: 1.0,    // margen extra entre los huecos y la pared del inserto
  objRotate: 0,         // (obsoleto) giro manual del contenido
  objSpacing: 3,        // pared mínima entre alojamientos
  objRotateAllow: true, // el acomodo puede girar los objetos 90/180/270°
  contentFit: 'auto',   // 'auto' = la caja se ajusta al contenido | 'manual'

  // --- Calidad ---
  quality: 'preview',
};

/**
 * Modo ahorro de material: transforma los parámetros (solo REDUCE, nunca
 * añade material) manteniendo toda la mecánica, el cierre y la impresión sin
 * soportes. Con `eco` apagado devuelve P tal cual (cero cambios).
 *
 *  - Pared: 4 líneas, mínimo 1.6 mm (el mismo suelo que usa el optimizador
 *    de cama por rigidez y estanqueidad). Antes 6 líneas.
 *  - Fondo y techo: 5 capas, mínimo 1.0 mm (6 capas / 1.2 mm en cajas de más
 *    de 190 mm). La regla de 2 líneas/capas sigue cumpliéndose.
 *  - Banda: vuelo máximo 2.4 mm (la junta sigue cabiendo; ver optimizador).
 *  - Sin nervios de esquina (parachoques), chaflán interior 1.2 mm.
 *  - Patrón grabado: sigue grabado, con piel mínima (≥ 0.9 mm en capas
 *    enteras) bajo las celdas en vez de 1.2 mm. Antes pasaba a
 *    relieve, que impreso boca abajo deja la cara colgando (puentes en toda
 *    la cara y ménsula en el borde) y además pesa más.
 *  - Inserto: cubierta de 1.0 mm (5 capas) y nervios cada 60 mm.
 *  - Organizador: divisores de 2 líneas y tapa interior de 3 líneas.
 * La mecánica (bisagras, cierres, pasadores, junta, holguras calibradas) no
 * se toca: sus cotas dependen de la clase de tamaño, no de estos ajustes.
 */
export function ecoParams(P) {
  if (!P || !P.eco || P._eco) return P;
  const lw = P.lineWidth || 0.45, lh = P.layerH || 0.2;
  const Q = { ...P, _eco: true };
  const ch = [];
  const lower = (k, v, label) => {
    v = Math.round(v * 100) / 100;
    if (Q[k] > v + 1e-9) { ch.push(`${label} ${Q[k]} → ${v} mm`); Q[k] = v; }
  };
  const big = Math.max(P.innerL, P.innerW) > 190;
  // Nervado: piel de 3 líneas (mínimo para que sea estanca) y la rigidez la
  // ponen los nervios verticales (ver wallRibs en derive).
  const rib = (P.ecoDesign === 'rib' || P.ecoDesign === 'ribStiff') && !P.stackable;
  if (rib) Q._ecoRib = P.ecoDesign === 'ribStiff' ? 'stiff' : 'light';
  Q._wall0 = P.wall;
  lower('wall', rib ? Math.max(3 * lw, 1.2) : Math.max(4 * lw, 1.6), 'pared');
  lower('floor', Math.max((big ? 6 : 5) * lh, big ? 1.2 : 1.0), 'fondo');
  lower('top', Math.max((big ? 6 : 5) * lh, big ? 1.2 : 1.0), 'techo');
  if (Q.floorChamfer > 1.2) lower('floorChamfer', 1.2, 'chaflán interior');
  if (Q.cornerRibs) { Q.cornerRibs = false; ch.push('sin nervios de esquina'); }
  // Patrón grabado: se mantiene el grabado (el relieve, impreso boca abajo,
  // deja toda la cara colgando sobre los nervios) pero con piel mínima bajo
  // las celdas (ver derive).
  if (Q.relief === 'engrave' && Q.pattern !== 'smooth' && !Q.stackable) Q._ecoEngrave = true;
  {
    const cm = contentModes(Q);
    if ([cm.base, cm.lid].some((m) => m === 'blank' || m === 'pockets')) lower('insertDeck', Math.max(5 * lh, 1.0), 'cubierta del inserto');
  }
  Q._ecoChanges = ch;
  return Q;
}

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
  if (s.patternSize === 12) s.patternSize = 11.5;   // antiguo valor por defecto (celda > 10 mm)
  // v7.3: un selector por mitad en vez de `lidOrg` / `insertLid`.
  if (s.lidMode === undefined && (s.lidOrg || s.insertLid)) s.lidMode = s.lidOrg ? 'org' : 'blank';
  delete s.lidOrg; delete s.insertLid;
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

/**
 * Pestañas de la interfaz, en el orden del flujo de trabajo.
 *   caja → contenido → tapa → mecánica → impresión
 */
export const TABS = [
  ['caja', 'Caja', 'Medidas, forma y estructura'],
  ['contenido', 'Contenido', 'Objetos e insertos a medida'],
  ['tapa', 'Tapa', 'Patrón y logo'],
  ['mecanica', 'Mecánica', 'Bisagras, cierres y sellado'],
  ['impresion', 'Impresión', 'Impresora, soportes y acabado'],
];

/**
 * Cada grupo pertenece a una pestaña. Los controles con `adv: true` solo se
 * muestran en "Modo experto"; `hint` es una ayuda de una línea; `when(P)`
 * (en un control o en un grupo) lo oculta cuando no aplica.
 */
const FILL_OPTIONS = [['off', 'Nada'], ['blank', 'Inserto en blanco'], ['pockets', 'Inserto con huecos para los objetos'], ['org', 'Compartimentos']];
const COVER_OPTIONS = [['single', 'Una para todos los compartimentos'], ['row', 'Una por fila'], ['cell', 'Una por compartimento'], ['none', 'Sin tapa interior']];
const orgOn = (side) => (P) => contentModes(P)[side] === 'org';
const insOn = (side) => (P) => ['blank', 'pockets'].includes(contentModes(P)[side]);
const anyInsert = (P) => insOn('base')(P) || insOn('lid')(P);
const anyPockets = (P) => { const m = contentModes(P); return m.base === 'pockets' || m.lid === 'pockets'; };
const anyOrgCover = (P) => { const m = contentModes(P); return (m.base === 'org' && P.orgBCover !== 'none') || (m.lid === 'org' && P.orgCover !== 'none'); };

export const SCHEMA = [
  /* ---------------- Caja ---------------- */
  { tab: 'caja', group: 'Medidas interiores', items: [
    { k: 'innerL', label: 'Largo', type: 'range', min: 20, max: 400, step: 0.5, unit: 'mm', hint: 'Espacio útil, sin paredes' },
    { k: 'innerW', label: 'Ancho', type: 'range', min: 20, max: 400, step: 0.5, unit: 'mm' },
    { k: 'baseDepth', label: 'Profundidad de la base', type: 'range', min: 5, max: 250, step: 0.5, unit: 'mm' },
    { k: 'lidDepth', label: 'Profundidad de la tapa', type: 'range', min: 0, max: 120, step: 0.5, unit: 'mm' },
    { k: 'lidMin', label: 'Tapa lo más plana posible', type: 'toggle', hint: 'Para objetos que quedan a ras del borde' },
  ]},
  { tab: 'caja', group: 'Forma', items: [
    { k: 'innerR', label: 'Radio de las esquinas', type: 'range', min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    { k: 'cornerCut', label: 'Esquinas recortadas (octógono)', type: 'range', min: 0, max: 80, step: 0.5, unit: 'mm', hint: 'Ayuda a que una caja larga quepa en la cama' },
    { k: 'cornerRibs', label: 'Nervios de esquina', type: 'toggle' },
  ]},
  { tab: 'caja', group: 'Paredes', items: [
    { k: 'eco', label: 'Modo ahorro de material', type: 'toggle',
      hint: 'Mínimo filamento con la misma mecánica y cierre: paredes y fondos mínimos seguros, banda estrecha, grabado con piel mínima…' },
    { k: 'ecoDesign', label: 'Diseño del modo ahorro', type: 'select', when: (P) => !!P.eco, options: [
      ['min', 'Mínimos (mismo diseño)'], ['rib', 'Nervado ligero (máximo ahorro)'], ['ribStiff', 'Nervado rígido (como la caja normal)']],
      hint: 'Nervado: pared de 3 líneas con nervios verticales. Ligero ahorra más; rígido iguala a la caja normal' },
    { k: 'wall', label: 'Pared', type: 'range', min: 1.2, max: 5, step: 0.05, unit: 'mm' },
    { k: 'floor', label: 'Fondo', type: 'range', min: 1.2, max: 5, step: 0.1, unit: 'mm', adv: true },
    { k: 'top', label: 'Techo de la tapa', type: 'range', min: 1.2, max: 5, step: 0.1, unit: 'mm', adv: true },
    { k: 'bandH', label: 'Altura de la banda', type: 'range', min: 3, max: 12, step: 0.5, unit: 'mm', adv: true },
    { k: 'bandProud', label: 'Vuelo de la banda (0 = auto)', type: 'range', min: 0, max: 8, step: 0.1, unit: 'mm', adv: true },
  ]},
  { tab: 'caja', group: 'Apilado y Gridfinity', gridfinity: true, items: [
    { k: 'stackable', label: 'Apilable', type: 'toggle', hint: 'La base encaja sobre la tapa de otra caja igual' },
    { k: 'gridfinity', label: 'Gridfinity', type: 'select', options: [
      ['off', 'No'], ['baseplate', 'Placa interior (bins dentro)'], ['feet', 'Pies (caja sobre placa)']] },
  ]},

  /* ---------------- Contenido ---------------- */
  { tab: 'contenido', group: 'Objetos', content: true, items: [
    { k: 'contentFit', label: 'Tamaño de la caja', type: 'select', options: [
      ['auto', 'Ajustarlo al contenido'], ['manual', 'Usar las medidas de la pestaña Caja']] },
    { k: 'objSpacing', label: 'Pared entre objetos', type: 'range', min: 1.2, max: 10, step: 0.2, unit: 'mm', hint: 'Más pared = inserto más rígido' },
    { k: 'objRotateAllow', label: 'Permitir girar objetos', type: 'toggle', hint: 'Giros de 90° y 180° para encajarlos mejor' },
    { k: 'objClearance', label: 'Margen hasta la pared', type: 'range', min: 0, max: 10, step: 0.5, unit: 'mm', adv: true },
  ]},
  // Qué lleva cada mitad. Los ajustes de cada opción solo aparecen cuando
  // esa opción está elegida (`when`): la interfaz enseña lo que aplica.
  { tab: 'contenido', group: 'En la base', items: [
    { k: 'insertMode', label: 'La base lleva', type: 'select', options: FILL_OPTIONS },
    { k: 'orgBCols', label: 'Columnas (lado largo)', type: 'range', min: 1, max: 20, step: 1, unit: '', when: orgOn('base') },
    { k: 'orgBRows', label: 'Filas (lado corto)', type: 'range', min: 1, max: 12, step: 1, unit: '', when: orgOn('base') },
    { k: 'orgBCover', label: 'Tapa interior', type: 'select', options: COVER_OPTIONS, when: orgOn('base'),
      hint: 'Con bisagra de pivotes: sin piezas sueltas' },
    { k: 'orgBMinL', label: 'Largo mínimo de cada celda (0 = repartir)', type: 'range', min: 0, max: 150, step: 0.5, unit: 'mm', when: orgOn('base'), hint: 'Si no caben, la caja crece' },
    { k: 'orgBMinW', label: 'Ancho mínimo de cada celda (0 = repartir)', type: 'range', min: 0, max: 150, step: 0.5, unit: 'mm', when: orgOn('base') },
    { k: 'orgBDepth', label: 'Altura de las celdas (0 = la de la base)', type: 'range', min: 0, max: 200, step: 0.5, unit: 'mm', when: orgOn('base'), hint: 'Si no caben, la base crece' },
    { k: 'orgBScoop', label: 'Fondo inclinado para recoger piezas', type: 'toggle', adv: true, when: orgOn('base') },
    { k: 'insertH', label: 'Altura del inserto (0 = auto)', type: 'range', min: 0, max: 200, step: 0.5, unit: 'mm', adv: true, when: insOn('base') },
  ]},
  { tab: 'contenido', group: 'En la tapa', items: [
    { k: 'lidMode', label: 'La tapa lleva', type: 'select', options: FILL_OPTIONS },
    { k: 'orgCols', label: 'Columnas (lado largo)', type: 'range', min: 1, max: 20, step: 1, unit: '', when: orgOn('lid') },
    { k: 'orgRows', label: 'Filas (lado corto)', type: 'range', min: 1, max: 12, step: 1, unit: '', when: orgOn('lid') },
    { k: 'orgCover', label: 'Tapa interior', type: 'select', options: COVER_OPTIONS, when: orgOn('lid'),
      hint: 'Con bisagra de pivotes: sin piezas sueltas' },
    { k: 'orgMinL', label: 'Largo mínimo de cada celda (0 = repartir)', type: 'range', min: 0, max: 150, step: 0.5, unit: 'mm', when: orgOn('lid'), hint: 'Si no caben, la caja crece' },
    { k: 'orgMinW', label: 'Ancho mínimo de cada celda (0 = repartir)', type: 'range', min: 0, max: 150, step: 0.5, unit: 'mm', when: orgOn('lid') },
    { k: 'orgDepth', label: 'Altura de las celdas (0 = la de la tapa)', type: 'range', min: 0, max: 120, step: 0.5, unit: 'mm', when: orgOn('lid'), hint: 'Si no caben, la tapa crece' },
    { k: 'orgScoop', label: 'Fondo inclinado para recoger piezas', type: 'toggle', adv: true, when: orgOn('lid') },
  ]},
  { tab: 'contenido', group: 'Traba de las tapas interiores', when: (P) => anyOrgCover(P), items: [
    { k: 'orgLatch', label: 'Traba', type: 'select', options: [
      ['snap', 'Mecánica (clic)'], ['magnet', 'Magnética (imanes)']],
      hint: 'Mecánica: sin piezas extra. Magnética: una pareja de imanes de disco por punto de cierre, a presión' },
    { k: 'magnetD', label: 'Diámetro del imán', type: 'range', min: 2, max: 20, step: 0.5, unit: 'mm', when: (P) => P.orgLatch === 'magnet',
      hint: 'La medida nominal del imán de disco (p. ej. 6 × 2): el alojamiento ya lleva su ajuste a presión' },
    { k: 'magnetH', label: 'Altura del imán', type: 'range', min: 0.5, max: 6, step: 0.5, unit: 'mm', when: (P) => P.orgLatch === 'magnet',
      hint: 'Si la tapa va a cargar tornillería pesada, mejor imanes de 8 × 3 o mayores' },
    { k: 'magnetCount', label: 'Imanes por tapa interior', type: 'select', when: (P) => P.orgLatch === 'magnet',
      options: [[0, 'Automático (los sugeridos)'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']],
      hint: 'Son parejas: cada punto lleva un imán en la caja y otro en la tapa interior. El resumen dice cuántos se sugieren y por qué' },
  ]},
  { tab: 'contenido', group: 'Insertos', when: (P) => anyInsert(P), items: [
    { k: 'fingerCount', label: 'Huecos para los dedos', type: 'select', options: [
      ['auto', 'Automático (2)'], ['0', 'Ninguno'], ['1', 'Uno'], ['2', 'Dos']], when: (P) => anyPockets(P) },
    { k: 'fingerD', label: 'Tamaño del hueco para dedo', type: 'range', min: 10, max: 40, step: 1, unit: 'mm', when: (P) => anyPockets(P) },
    { k: 'pocketTol', label: 'Holgura del objeto', type: 'range', min: 0, max: 3, step: 0.05, unit: 'mm', cal: true, hint: 'Juego entre el objeto y su hueco', when: (P) => anyPockets(P) },
    { k: 'insertTol', label: 'Holgura con la caja', type: 'range', min: 0, max: 1.5, step: 0.025, unit: 'mm', cal: true, adv: true },
    { k: 'insertDeck', label: 'Espesor de la cubierta', type: 'range', min: 0.8, max: 4, step: 0.2, unit: 'mm', adv: true },
    { k: 'fingerPos', label: 'Posición de los huecos', type: 'range', min: -100, max: 100, step: 5, unit: '%', adv: true, when: (P) => anyPockets(P) },
  ]},

  /* ---------------- Tapa ---------------- */
  { tab: 'tapa', group: 'Diseño de la tapa', items: [
    { k: 'pattern', label: 'Patrón', type: 'select', options: [
      ['smooth', 'Liso'], ['hex', 'Hexagonal'], ['stripes', 'Estriado'], ['cross', 'Reforzado cruzado'],
      ['circuit', 'Sci‑fi: circuito'], ['radial', 'Sci‑fi: radial']] },
    { k: 'relief', label: 'Acabado', type: 'select', options: [
      ['engrave', 'Grabado (recomendado)'], ['emboss', 'En relieve']] },
    { k: 'patternSize', when: (P) => P.pattern !== 'smooth', label: 'Tamaño del patrón', type: 'range', min: 4, max: 40, step: 0.5, unit: 'mm' },
    { k: 'patternDepth', label: 'Profundidad', type: 'range', min: 0.4, max: 2, step: 0.1, unit: 'mm', adv: true },
    { k: 'patternRib', when: (P) => P.pattern !== 'smooth', label: 'Grosor de línea', type: 'range', min: 0.8, max: 5, step: 0.1, unit: 'mm', adv: true },
    { k: 'patternMargin', when: (P) => P.pattern !== 'smooth', label: 'Margen al borde', type: 'range', min: 2, max: 20, step: 0.5, unit: 'mm', adv: true },
    { k: 'stripeAngle', label: 'Ángulo', type: 'range', min: 0, max: 180, step: 5, unit: '°', adv: true, when: (P) => P.pattern === 'stripes' },
    { k: 'patternSeed', label: 'Variante', type: 'range', min: 1, max: 999, step: 1, unit: '', adv: true, when: (P) => P.pattern === 'circuit' },
  ]},
  { tab: 'tapa', group: 'Logo', svg: true, items: [
    { k: 'svgSize', label: 'Tamaño', type: 'range', min: 5, max: 100, step: 1, unit: '%' },
    { k: 'svgRotate', label: 'Giro', type: 'range', min: -180, max: 180, step: 1, unit: '°' },
    { k: 'svgOffsetX', label: 'Mover en X', type: 'range', min: -150, max: 150, step: 0.5, unit: 'mm', adv: true },
    { k: 'svgOffsetY', label: 'Mover en Y', type: 'range', min: -150, max: 150, step: 0.5, unit: 'mm', adv: true },
  ]},

  /* ---------------- Mecánica ---------------- */
  { tab: 'mecanica', group: 'Bisagras y cierres', items: [
    { k: 'sizeClass', label: 'Robustez', type: 'select', options: [
      ['auto', 'Automática según tamaño'], ['XS', 'XS — ultrapequeña (< 50 mm)'], ['S', 'S — pequeña'], ['M', 'M — mediana'], ['L', 'L — grande']],
      hint: 'Escala bisagras y cierres; automática elige XS por debajo de 50 mm exteriores' },
    { k: 'pinMode', label: 'Pasadores', type: 'select', options: [
      ['auto', 'Automático'], ['filament', 'Trozo de filamento 1.75 mm'], ['printed', 'Impresos (a presión)']] },
    { k: 'hingeCount', label: 'Bisagras (0 = auto)', type: 'range', min: 0, max: 4, step: 1, unit: '', adv: true },
    { k: 'latchCount', label: 'Cierres (0 = auto)', type: 'range', min: 0, max: 4, step: 1, unit: '', adv: true },
    { k: 'clearance', label: 'Holgura de pasadores impresos', type: 'range', min: 0.05, max: 0.5, step: 0.025, unit: 'mm', cal: true, hint: 'Viene del perfil de calibración (pestaña Impresión)' },
    { k: 'filClr', label: 'Holgura del filamento', type: 'range', min: 0, max: 0.4, step: 0.025, unit: 'mm', cal: true, adv: true },
    { k: 'axialGap', label: 'Holgura entre nudillos', type: 'range', min: 0.2, max: 0.8, step: 0.05, unit: 'mm', cal: true, adv: true },
  ]},
  { tab: 'mecanica', group: 'Sellado', items: [
    { k: 'sealMode', label: 'Junta entre tapa y base', type: 'select', options: [
      ['tpu', 'Junta de TPU impresa (hermético)'], ['cord', 'Cordón de filamento TPU 1,75 (hermético, sin imprimir)'],
      ['labyrinth', 'Laberinto doble'], ['simple', 'Lengüeta simple']],
      hint: 'Cordón: se corta un trozo de filamento TPU y se mete en la ranura; no hay que imprimir la junta' },
    { k: 'gasketCompression', label: 'Compresión de la junta', type: 'range', min: 0.15, max: 0.35, step: 0.01, unit: '', adv: true,
      when: (P) => P.sealMode === 'tpu' || P.sealMode === 'cord' },
    { k: 'sealClr', label: 'Holgura de la lengüeta', type: 'range', min: 0.05, max: 0.6, step: 0.025, unit: 'mm', cal: true, adv: true },
  ]},

  /* ---------------- Impresión ---------------- */
  { tab: 'impresion', group: 'Impresora', items: [
    { k: 'bedPreset', label: 'Modelo', type: 'select',
      options: Object.entries(BED_PRESETS).map(([k, v]) => [k, v.name]) },
    { k: 'bedX', label: 'Cama X', type: 'range', min: 100, max: 500, step: 1, unit: 'mm', adv: true },
    { k: 'bedY', label: 'Cama Y', type: 'range', min: 100, max: 500, step: 1, unit: 'mm', adv: true },
    { k: 'bedZ', label: 'Altura Z', type: 'range', min: 100, max: 500, step: 1, unit: 'mm', adv: true },
    { k: 'lineWidth', label: 'Ancho de línea', type: 'range', min: 0.3, max: 0.8, step: 0.01, unit: 'mm', adv: true },
    { k: 'layerH', label: 'Altura de capa', type: 'range', min: 0.08, max: 0.32, step: 0.02, unit: 'mm', adv: true },
  ]},
  // Perfil de calibración: estos valores son de la IMPRESORA y el material,
  // no del diseño. Se guardan aparte (perfil persistente) y se aplican a
  // todas las cajas; el test de holguras los mide (ver src/engine/calib.js).
  { tab: 'impresion', group: 'Calibración de holguras', calib: true, items: [
    { k: 'filClr', label: 'Filamento en bisagra', type: 'range', min: 0, max: 0.4, step: 0.025, unit: 'mm', cal: true,
      hint: 'Holgura por lado del filamento 1.75 en los agujeros de la caja' },
    { k: 'clearance', label: 'Pasador impreso (Ø3)', type: 'range', min: 0.05, max: 0.5, step: 0.025, unit: 'mm', cal: true,
      hint: 'Holgura por lado del pasador impreso en bisagras y orejetas' },
    { k: 'clearanceL', label: 'Pasador impreso grande (Ø5)', type: 'range', min: 0.05, max: 0.5, step: 0.025, unit: 'mm', cal: true,
      hint: 'Cajas grandes; entre Ø3 y Ø5 se interpola' },
    { k: 'tiltAdd', label: 'Extra si se imprime inclinada', type: 'range', min: -0.2, max: 0.4, step: 0.025, unit: 'mm', cal: true,
      hint: 'Se suma a los agujeros de bisagra y cierre cuando la caja no cabe plana' },
    { k: 'latchPre', label: 'Precarga del cierre', type: 'range', min: 0, max: 0.5, step: 0.025, unit: 'mm', cal: true,
      hint: 'Cuánto aprieta el gancho sobre el retén' },
    { k: 'holeComp', label: 'Agujeros verticales (cierre, tapones)', type: 'range', min: 0, max: 0.6, step: 0.025, unit: 'mm', cal: true,
      hint: 'Cuánto se agrandan para compensar que salen más pequeños' },
    { k: 'sealClr', label: 'Lengüeta en la ranura', type: 'range', min: 0.05, max: 0.6, step: 0.025, unit: 'mm', cal: true },
    { k: 'axialGap', label: 'Entre nudillos', type: 'range', min: 0.2, max: 0.8, step: 0.025, unit: 'mm', cal: true, adv: true },
    { k: 'stackClr', label: 'Apilado', type: 'range', min: 0.1, max: 0.8, step: 0.025, unit: 'mm', cal: true, adv: true },
    { k: 'insertTol', label: 'Inserto en la caja', type: 'range', min: 0, max: 1.5, step: 0.025, unit: 'mm', cal: true, adv: true },
    { k: 'pocketTol', label: 'Objeto en su hueco', type: 'range', min: 0, max: 3, step: 0.05, unit: 'mm', cal: true, adv: true },
  ]},
  { tab: 'impresion', group: 'Soportes y adherencia', items: [
    { k: 'printAids', label: 'Ayudas de impresión', type: 'select', options: [
      ['auto', 'Automáticas (recomendado)'], ['nofins', 'Sin aletas'], ['off', 'Ninguna']],
      hint: 'Orejas en diagonal; bisel, aletas y soportes si va inclinada' },
    { k: 'aidsInPart', label: 'Soportes dentro del STL de la pieza', type: 'toggle' },
    { k: 'overhangSupports', label: 'Soportar partes que sobresalen', type: 'toggle', adv: true },
    { k: 'overhangAngle', label: 'Voladizo máximo sin soporte', type: 'range', min: 40, max: 65, step: 1, unit: '°', adv: true },
    { k: 'maxBridge', label: 'Puente máximo sin soporte', type: 'range', min: 5, max: 20, step: 0.5, unit: 'mm', adv: true, hint: 'Orca/Bambu soportan puentes > 10 mm: el diseño se mantiene por debajo' },
    { k: 'supportPitch', label: 'Densidad de soportes (paso)', type: 'range', min: 2, max: 8, step: 0.5, unit: 'mm', adv: true },
    { k: 'finSpacing', when: (P) => P.printAids === 'auto', label: 'Separación de aletas (0 = auto)', type: 'range', min: 0, max: 80, step: 1, unit: 'mm', adv: true },
    { k: 'finReach', when: (P) => P.printAids === 'auto', label: 'Alcance de aletas (0 = auto)', type: 'range', min: 0, max: 100, step: 5, unit: '%', adv: true },
    { k: 'toothPitch', when: (P) => P.printAids === 'auto', label: 'Paso de dientes de aleta', type: 'range', min: 3, max: 15, step: 0.5, unit: 'mm', adv: true },
    { k: 'finGap', when: (P) => P.printAids === 'auto', label: 'Holgura de aleta (0 = auto)', type: 'range', min: 0, max: 1, step: 0.05, unit: 'mm', adv: true },
  ]},
  { tab: 'impresion', group: 'Acabado (línea de contracción)', items: [
    { k: 'shadowLine', label: 'Ranuras que ocultan la línea', type: 'toggle' },
    { k: 'floorChamfer', label: 'Chaflán interior', type: 'range', min: 0, max: 8, step: 0.2, unit: 'mm', adv: true },
    { k: 'snapToPrinter', label: 'Ajustar medidas a capas y líneas', type: 'toggle', adv: true },
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
  // XS (ultrapequeña, < 50 mm por fuera): todo a escala, sin bajar de los
  // mínimos de impresión (≥ 3.5 líneas alrededor de cada agujero, placas de
  // 4 capas, cotas de 2 líneas). Ver la tabla comparativa en el README.
  XS: { pinD: 2.5, latchPin: 'filament', latchPinD: 2.5, plate: 1.6, latchW: 7, cheek: 2.4, kth: 1.6, bo: 1.8, hinges: 1, latches: 1,
    rkWall: 1.6, rlWall: 1.3, tl: 1.8, hGap: 0.4, hh: 1.6, bandHlMin: 2.4, kd0: 1.3 },
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
  P = ecoParams(P);
  const warn = [];
  const D = { warn, snapped: [] };
  D.eco = !!P._eco;
  D.ecoChanges = [...(P._ecoChanges || [])];

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
  // Qué lleva cada mitad (inserto, compartimentos o nada).
  D.content = contentModes(P);
  // Compartimentos (tapa y/o base): si las celdas mínimas no caben, la caja crece.
  const OB = orgBase(P, lw, 'lid');
  let OBb = orgBase(P, lw, 'base');
  if (OBb && P.gridfinity === 'baseplate') {
    warn.push('Compartimentos en la base y placa Gridfinity interior no caben a la vez: se omiten los compartimentos de la base.');
    OBb = null; D.content = { ...D.content, base: 'off' };
  }
  for (const [O1, where] of [[OB, 'la tapa'], [OBb, 'la base']]) {
    if (!O1) continue;
    if (O1.needL > D.Li + 1e-6) { D.snapped.push(`interior ${r2(D.Li)} → ${O1.needL} mm de largo para ${O1.cols} celdas en ${where}`); D.Li = O1.needL; }
    if (O1.needW > D.Wi + 1e-6) { D.snapped.push(`interior ${r2(D.Wi)} → ${O1.needW} mm de ancho para ${O1.rows} filas en ${where}`); D.Wi = O1.needW; }
  }

  D.t = r2(snapW(P.wall)); note('Pared', P.wall, D.t);
  D.t0 = P._wall0 != null ? r2(snapW(P._wall0)) : D.t;      // pared sin modo ahorro
  D.ri = clamp(P.innerR, 0.5, Math.min(D.Li, D.Wi) / 2 - 0.5);
  // Esquinas recortadas: pierna del chaflán sobre el rectángulo interior.
  D.cham = r2(clamp(P.cornerCut || 0, 0, Math.min(D.Li, D.Wi) / 2 - D.ri - 1));
  if (D.cham < 1) D.cham = 0;
  D.innerOutline = D.cham > 0 ? octagonPts(D.Li, D.Wi, D.cham)
    : [[-D.Li / 2, -D.Wi / 2], [D.Li / 2, -D.Wi / 2], [D.Li / 2, D.Wi / 2], [-D.Li / 2, D.Wi / 2]];
  D.ro = D.ri + D.t;
  D.Lo = D.Li + 2 * D.t;
  D.Wo = D.Wi + 2 * D.t;

  /* ---- Clase de tamaño ---- */
  const maxDim = Math.max(D.Lo, D.Wo);
  D.cls = P.sizeClass !== 'auto' ? P.sizeClass : maxDim < 50 ? 'XS' : maxDim < 90 ? 'S' : maxDim < 200 ? 'M' : 'L';
  const Mx = MECH[D.cls];
  D.pinMode = P.pinMode !== 'auto' ? P.pinMode : D.cls === 'S' || D.cls === 'XS' ? 'filament' : 'printed';
  D.clr = P.clearance;
  D.ag = P.axialGap;

  // Bisagra
  // Holguras de la impresora (perfil de calibración, ver calib.js).
  D.filClr = clamp(P.filClr ?? 0.125, 0, 0.4);
  D.sealClr = clamp(P.sealClr ?? 0.25, 0.05, 0.6);
  // Holgura del pasador impreso según su diámetro: medida en Ø3 (clearance)
  // y Ø5 (clearanceL), interpolada entre ambos.
  const clrAt = (d) => {
    const a = P.clearance ?? 0.25, b = P.clearanceL ?? a;
    return r2(a + (b - a) * clamp((d - 3) / 2, 0, 1));
  };
  // Pieza impresa INCLINADA (no cabe plana; lo decide engine.js con
  // fitsFlat): los agujeros de bisagras y orejetas quedan a ~45°, ni
  // horizontales ni verticales, y llevan su holgura extra medida (tiltAdd).
  D.tilted = !!P._tilted;
  D.tiltAdd = D.tilted ? r2(clamp(P.tiltAdd ?? 0, -0.2, 0.4)) : 0;
  const filClr0 = D.filClr;                       // sin inclinar (piezas sueltas)
  D.filClr = r2(clamp(D.filClr + D.tiltAdd, 0, 0.6));
  if (D.pinMode === 'filament') { D.pinD = 1.75; D.holeD = r2(1.75 + 2 * D.filClr); }
  else { D.pinD = Mx.pinD; D.clr = r2(Math.max(0.02, clrAt(Mx.pinD) + D.tiltAdd)); D.holeD = r2(Mx.pinD + 2 * D.clr); }
  D.clrH = D.pinMode === 'filament' ? D.filClr : D.clr;
  // Piezas sueltas (cierre y tapones): sus agujeros se imprimen VERTICALES,
  // y un agujero vertical sale 0.1–0.3 mm más pequeño (perímetros que
  // tiran hacia dentro + pata de elefante en la primera capa). holeComp se
  // suma al diámetro. Los agujeros de base y tapa (horizontales, teardrop)
  // no lo necesitan.
  D.holeComp = r2(clamp(P.holeComp ?? 0.15, 0, 0.6));
  // Tapón tipo pinza: agujero 0.2 mm por debajo del filamento (+ compensación)
  // con una ranura lateral: la pared se abre y agarra sin exigir una medida
  // exacta del agujero.
  D.capHoleD = r2(1.75 - 0.2 + D.holeComp);
  D.rk = r2(D.holeD / 2 + Math.max(Mx.rkWall ?? 2.2, D.pinD * 0.55));

  // Cierre (pasador propio)
  D.latchPinMode = P.pinMode === 'filament' ? 'filament' : P.pinMode === 'printed' ? 'printed' : Mx.latchPin;
  if (D.latchPinMode === 'filament') { D.latchPinD = 1.75; D.latchHoleD = r2(1.75 + 2 * D.filClr); }
  else {
    D.latchPinD = Mx.latchPinD;
    D.clrL = r2(Math.max(0.02, clrAt(Mx.latchPinD) + D.tiltAdd));
    D.latchHoleD = r2(Mx.latchPinD + 2 * D.clrL);
  }
  D.clrL ??= D.filClr;
  // El cierre es una pieza suelta que se imprime SIEMPRE de lado: su barril
  // no lleva la holgura de inclinación de las orejetas de la caja.
  const latchHole0 = D.latchPinMode === 'filament' ? 1.75 + 2 * filClr0 : D.latchPinD + 2 * (D.clrL - D.tiltAdd);
  D.rl = r2(D.latchHoleD / 2 + Math.max(Mx.rlWall ?? 1.6, D.latchPinD * 0.45));
  // Agujero del barril del CIERRE (pieza suelta, agujero vertical al imprimir):
  // ajuste de giro (pasador + 2·holgura) + compensación.
  D.latchBoreD = r2(latchHole0 + D.holeComp);

  /* ---- Banda ---- */
  D.bo = r2(P.bandProud > 0 ? P.bandProud : D.eco ? Math.min(Mx.bo, 2.4) : Mx.bo);
  if (D.eco) {
    // Con la pared fina, la cara de unión debe seguir dejando ≥ 2 líneas a
    // cada lado de la ranura de la junta/lengüeta: si no, crece la banda
    // (más barato que engrosar toda la pared).
    const bo0 = P.bandProud > 0 ? P.bandProud : Mx.bo;
    const Fmin = r2((P.sealMode === 'tpu' ? 2.4 : P.sealMode === 'cord' ? 2.2 : 2.0) + 2 * Math.max(0.9, 2 * lw) + 0.05);
    if (D.t + D.bo < Fmin) D.bo = r2(Fmin - D.t);
    if (D.bo !== bo0) D.ecoChanges.push(`banda ${bo0} → ${D.bo} mm${D.bo > bo0 ? ' (ranura con 2 líneas por lado)' : ''}`);
  }
  D.F = r2(D.t + D.bo);              // ancho de la cara de unión

  /* ---- Sellado ---- */
  D.sealMode = P.sealMode;
  D.tl = Mx.tl ?? 2.4;               // longitud de la lengüeta
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
  } else if (D.sealMode === 'cord') {
    // Junta de CORDÓN: un trozo de filamento TPU de 1.75 mm sin imprimir
    // (como el cordón tórico de las cajas comerciales). Mismas reglas que la
    // junta impresa: compresión 20–30 % (la fija el tope duro cara con cara)
    // y llenado del alojamiento ≤ 85 %.
    D.c = clamp(P.gasketCompression, 0.15, 0.35);
    D.cordD = 1.75;
    const area = (Math.PI * D.cordD ** 2) / 4;
    D.gap = r2(D.cordD * (1 - D.c));
    D.gw = r2(clamp(area / (0.85 * D.gap), 2.0, 3.0));
    D.gd = r2(D.tl + D.gap);
    D.fill = r2(area / (D.gw * D.gap));
    D.grooves = [{ off: D.F / 2, w: D.gw }];
  } else if (D.sealMode === 'labyrinth') {
    // Doble ranura solo si cabe sin bajar de 2 líneas: paredes entre ranuras
    // ≥ 2 líneas y punta de cada lengüeta (gw − 2·clr − 0.4) ≥ 2 líneas.
    // Antes, con banda estrecha, quedaban paredes de 0.1–0.7 mm y lengüetas
    // de 0.7 mm (se transparentan y se parten).
    const wmin = Math.max(0.9, 2 * lw);
    const gwMin = r2(wmin + 0.4 + 2 * D.sealClr);
    D.gd = r2(D.tl + 0.5);
    if (3 * wmin + 2 * gwMin <= D.F + 1e-6) {
      const gw2 = r2(clamp((D.F - 3 * wmin) / 2, gwMin, 3.0));
      const w = (D.F - 2 * gw2) / 3;
      D.gw = gw2;
      D.grooves = [{ off: w + gw2 / 2, w: gw2 }, { off: D.F - w - gw2 / 2, w: gw2 }];
    } else {
      D.gw = r2(clamp(0.45 * D.F, Math.max(2.0, gwMin), 3.6));
      D.grooves = [{ off: D.F / 2, w: D.gw }];
      D.snapped.push(`laberinto de una sola ranura (banda de ${r2(D.F)} mm: la doble necesita ${r2(3 * wmin + 2 * gwMin)} mm)`);
    }
  } else {
    D.gw = r2(clamp(0.45 * D.F, 2.0, 3.6));
    D.gd = r2(D.tl + 0.5);
    D.grooves = [{ off: D.F / 2, w: D.gw }];
  }
  D.tw = r2(D.gw - 2 * D.sealClr);
  D.bandH = r2(snapH(Math.max(P.bandH, D.gd + 1.5)));

  /* ---- Cierre empotrado (sección en s = distancia hacia fuera) ----
   *  sw: cara de la pared · sb: cara de la banda · sp: eje del cierre
   *  skt: punta del retén · spi/sh: caras interior/exterior de la placa
   *  Condición de autobloqueo: el centro del contacto gancho‑retén queda
   *  FUERA del eje (s mayor) → la reacción de la junta cierra el cierre.  */
  D.lt = Mx.plate;
  D.kth = Mx.kth;
  D.kc = 0.6;
  D.pre = r2(clamp(P.latchPre ?? 0.15, 0, 0.5));   // precarga gancho ↔ retén (calibrable)
  D.cheekW = Mx.cheek;
  D.sw = D.Wi / 2 + D.t;
  D.sb = D.sw + D.bo;
  D.sp = r2(D.sw + 0.6 + D.rl);
  // Filamento: el eje queda por fuera de la cara de la banda/nervios de
  // esquina (sb) con holgura, para poder meter el trozo de filamento recto.
  if (D.latchPinMode === 'filament') D.sp = r2(Math.max(D.sp, D.sb + 0.9 + 0.2));
  D.skt = r2(Math.max(D.sb + (Mx.kd0 ?? 1.6), 2 * (D.sp + 0.4) - D.sb - 0.3 + D.kc));
  D.kd = r2(D.skt - D.sb);
  D.spi = r2(D.skt + 0.4);
  D.sh = r2(D.spi + D.lt);
  D.hh = Math.max(Mx.hh ?? 2.0, D.lt);
  // y en el marco interno (frente = −Y)
  D.yw = -D.sw; D.yfb = -D.sb; D.yp = -D.sp;
  // Techo del hueco del barril bajo la ranura de la junta: antes quedaba una
  // membrana de 0.5 mm (2.5 capas) que se transparentaba y podía partirse,
  // justo donde la junta empuja. Mínimo 6 capas / 3 líneas.
  D.mem = r2(Math.max(1.2, 6 * lh, 3 * lw));

  /* ---- Montaje real de los pasadores del cierre ----
   * El tapón del filamento (o la cabeza del pasador impreso) se apoya en la
   * cara exterior de la mejilla, justo bajo la banda. Antes el chaflán de 45°
   * de la banda invadía ese sitio (tapones imposibles de montar). Se baja el
   * eje lo justo para que el elemento de retención (radio R + holgura) libre
   * el chaflán y la cara inferior de la banda. Cotas relativas a Hb = 0.  */
  D.capR = 2.0;                                   // tapón Ø4 (agujero ciego 1.70)
  {
    const R = (D.latchPinMode === 'filament' ? D.capR : pinHeadR(D.latchPinD)) + 0.25;
    const zb = -D.bandH, zc = zb - D.bo, zp0 = -D.gd - D.mem - 0.5 - D.rl;
    let zp = Math.min(zp0, zc + (D.sp - D.sw) - Math.SQRT2 * R);          // chaflán a 45°
    const dy = D.sp - D.sb;
    if (dy < R) zp = Math.min(zp, zb - Math.sqrt(R * R - Math.max(0, dy) ** 2));   // cara inferior
    D.zpDrop = r2(Math.max(0, zp0 - zp));
  }

  /* ---- Anti hull‑line ---- */
  D.fc = r2(snapH(clamp(P.floorChamfer, 0, Math.min(D.Li, D.Wi) / 4)));
  if (P.floorChamfer === 0) D.fc = 0;
  D.shadow = !!P.shadowLine;
  // Profundidad de la V: 0.5 mm, pero la pared que queda detrás conserva
  // 2 líneas (0.9 mm) aunque sea fina (modo ahorro nervado: piel de 1.35).
  D.shadowV = r2(Math.min(0.5, D.t - 0.9));
  if (D.shadowV < 0.3) D.shadow = false;

  /* ---- Tapa artística / apilado ---- */
  D.pattern = P.pattern;
  D.relief = P.relief;
  D.pd = P.patternDepth;
  D.stack = !!P.stackable;
  D.hs = 2.0;                        // altura del marco de apilado
  D.sclr = r2(clamp(P.stackClr ?? 0.3, 0.1, 0.8));   // holgura de apilado (calibrable)
  D.db = 1.6;                        // bisel de 45° del borde superior de la tapa (bajo zTop)
  D.fwT = 1.6;                       // ancho de la cara superior del marco
  D.chB = 0.4;                       // chaflán exterior inferior de la base (apilable)
  D.frameIn = r2(D.t - D.db - D.hs - D.fwT);   // offset de la cara interior del marco
  D.sFoot = r2(D.frameIn - D.sclr);           // offset del pie de la base
  // Puente máximo sin soporte: Orca/Bambu Studio soportan cualquier puente
  // de más de 10 mm (por defecto). Toda zona en el aire de una pieza impresa
  // plana se diseña por debajo de este valor.
  D.maxBridge = clamp(P.maxBridge || 10, 4, 30);
  // Interfaz de apilado (v6.2, ver lidRelief en pattern.js y buildBase):
  //
  //        base de arriba:  pared recta hasta la cama ─┐
  //        faldón (cara interior a 45°) ──────────►  ╲ │
  //        canal oculto (techo = puente ~1.9 mm) ─►  ▔▔│
  //        pie ───────────►  ███  ┌──╱  ← marco: cara exterior a 45° (asiento cónico)
  //        tapa de abajo:  piel ──┘ ╱    nervios dentro del marco
  //                               ╱ ← bisel de 45° del borde de la tapa (db)
  //
  //  tapa → bisel de 45° en el borde que sube hasta el marco + nervios
  //         paralelos al lado largo a altura hs. Boca abajo: marco y nervios
  //         apoyan en la cama, todo lo demás crece a 45° o puentea ≤ 8 mm.
  //  base → la pared baja RECTA hasta la cama (bisagras y cierres intactos,
  //         igual que sin apilado); por debajo, un faldón con cara interior a
  //         45° y un canal donde entra el marco, y el pie con ranuras para los
  //         nervios. El asiento cónico centra y bloquea en X e Y.
  //  (Antes el pie se ensanchaba con un cono de 45° que recortaba la mecánica
  //   en bases poco profundas: hasta el 90 % de bisagra y orejetas.)
  D.hf = r2(D.hs + 0.3);             // altura del pie (> hs: apoya en la piel, no en el marco)
  D.rw = r2(Math.max(1.2, 3 * P.lineWidth));   // ancho de nervio
  D.gwS = r2(D.rw + 1.0);           // ancho de ranura del pie (0.5 mm por lado)
  D.stackRibs = { xs: [], ys: [] };
  const engr = !D.stack && P.relief === 'engrave' && P.pattern !== 'smooth';
  // Grabado: bajo cada celda queda una piel de 1.2 mm (modo ahorro: el
  // mínimo de 2 líneas, 0.9 mm, en capas enteras; la tapa queda como una
  // placa con retícula de nervios, más rígida que una lisa del mismo peso).
  const skin = P._ecoEngrave ? Math.ceil(0.9 / lh - 1e-6) * lh : 1.2;
  D.topT = r2(snapH(engr ? Math.max(P.top, D.pd + skin) : P.top));
  if (P._ecoEngrave) D.ecoChanges.push(`grabado con piel de ${r2(D.topT - D.pd)} mm bajo las celdas (techo ${D.topT} mm)`);
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
  // Celdas que caben enteras dentro del contorno (rectángulo u octógono).
  D.gfCells = [];
  if (D.gfMode !== 'off') {
    const feet = D.gfMode === 'feet';
    const outl = feet ? octagonPts(D.Lo, D.Wo, D.cham ? D.cham + D.t * (Math.SQRT2 - 1) : 0) : D.innerOutline;
    const half = feet ? 20.75 : 21;
    for (let i = 0; i < D.gfNx; i++) for (let j = 0; j < D.gfNy; j++) {
      const cx = (i - (D.gfNx - 1) / 2) * 42, cy = (j - (D.gfNy - 1) / 2) * 42;
      const ok = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => insideConvex(outl, cx + a * half, cy + b * half, feet ? 0 : 0.25));
      if (ok) D.gfCells.push([cx, cy]);
    }
    if (!D.gfCells.length) { warn.push('Ninguna celda Gridfinity cabe en este contorno.'); D.gfMode = 'off'; D.gfFeet = false; D.gfPlate = false; }
  }
  D.floorTop = r2(D.floor + (D.gfPlate ? D.gbH : 0) + (D.stack ? D.hf : 0));   // suelo útil
  if (D.stack) {
    // Nervios paralelos al lado largo (menos nervios y ranuras más largas y
    // rectas en la base), con paso ≤ 0.8·maxBridge + nervio entre bordes.
    const inW = D.Wi + 2 * D.frameIn;
    const pitch = 0.8 * D.maxBridge + D.rw;
    const n = Math.max(0, Math.ceil(inW / pitch) - 1);
    D.stackRibs.ys = Array.from({ length: n }, (_, i) => r2(-inW / 2 + (inW * (i + 1)) / (n + 1)));
    D.stackRibs.xs = [];
    D.stackRibs.pitch = r2(inW / (n + 1));
  }

  /* ---- Alturas ---- */
  // Base: el barril del cierre va bajo el fondo de la ranura; se necesita
  // sitio para él y su orejeta.
  const latchNeed = D.gd + D.mem + 0.5 + 2 * D.rl + 0.8 + D.zpDrop;
  const DbMin = r2(Math.max(latchNeed - D.floorTop, D.fc + 2, 5));
  let Db = P.baseDepth;
  if (Db < DbMin) { warn.push(`Base demasiado baja para los cierres: profundidad ajustada a ${DbMin} mm.`); Db = DbMin; }
  if (OBb) {
    // Celdas + tapa interior + holgura hasta el borde.
    const need = Math.max(OBb.needDl, r2(OBb.g0 + OBb.ct + 5));
    if (need > Db + 1e-6) { D.snapped.push(`base ${r2(Db)} → ${need} mm de profundidad para los compartimentos`); Db = need; }
  }
  D.Hb = r2(snapH(D.floorTop + Db));
  D.Db = r2(D.Hb - D.floorTop);

  // Tapa: banda + retén. Altura mínima para alojar el retén y la carcasa.
  D.bandHl = r2(snapH(Math.max(Mx.bandHlMin ?? 3.0, D.kth + 1.0)));
  // Sobre la banda cabe su chaflán de 45° entero (vuelo bo) + el bisel del
  // borde superior (0.5 mm; apilable: db): la tapa se imprime boca abajo y,
  // si no cabían, la banda quedaba en ménsula a 90° (tapa mínima).
  const HlMin = r2(D.bandHl + Math.max(1.6, D.bo + (D.stack ? D.db : 0.5)));
  const DlMin = r2(Math.max(0, HlMin - D.topT));
  let Dl = P.lidMin ? DlMin : P.lidDepth;
  if (Dl < DlMin) { if (!P.lidMin) warn.push(`Tapa ajustada a su mínimo mecánico: ${DlMin} mm.`); Dl = DlMin; }
  if (OB) {
    // Celdas + tapa interior + holgura hasta el borde.
    const need = Math.max(OB.needDl, r2(OB.g0 + OB.ct + 5));
    if (need > Dl + 1e-6) { D.snapped.push(`tapa ${r2(Dl)} → ${need} mm de profundidad para los compartimentos`); Dl = need; }
  }
  D.Hl = r2(snapH(D.topT + Dl));
  D.Dl = r2(D.Hl - D.topT);
  D.lidMin = DlMin;
  D.fcl = r2(Math.max(0, Math.min(D.fc, D.Dl - 0.4)));  // chaflán interior de la tapa

  /* ---- Cierre: alturas ---- */
  D.zp = r2(D.Hb - D.gd - D.mem - 0.5 - D.rl - D.zpDrop);   // eje del barril (0.5 de holgura bajo el techo)
  D.zkt = r2(D.Hb + D.bandHl);               // cara superior del retén
  D.zc = r2(D.zkt - D.pre);                  // cara de agarre del gancho

  /* ---- Bisagra ---- */
  D.hGap = Mx.hGap ?? 0.5;
  D.yb = D.Wi / 2 + D.F;                     // cara trasera de la banda
  D.ya = r2(D.yb + D.hGap + D.rk);
  // Eje a la altura de la PUNTA de la lengüeta: al abrir, la lengüeta sale
  // casi vertical de la ranura (cinemática en hinge.js).
  D.za = r2(D.Hb - D.tl);
  D.Lband = D.Li + 2 * D.F;
  D.Wband = D.Wi + 2 * D.F;

  /* ---- Presupuesto de longitud del lado largo ----
   * Prioridad: la mecánica nunca desaparece. Primero se calculan los mínimos
   * funcionales de bisagra y cierre; los nervios de esquina ceden longitud
   * (se acortan o se omiten) antes de recortar la mecánica.            */
  const minKl = r2(Math.max(4, 1.6 * D.pinD));          // nudillo más corto admisible
  const minHinge = 3 * minKl + 2 * D.ag;
  const minCheek = 2.4;
  const minLatch = 6 + 2 * (D.ag + minCheek);
  const needMin = Math.max(minHinge, minLatch);
  const avail0 = D.Lo - 2 * (D.ro + 2) - 2 * D.cham;    // tramo recto del lado largo
  D.ribs = !!P.cornerRibs && D.cham === 0;
  if (P.cornerRibs && D.cham > 0) D.snapped.push('nervios de esquina sustituidos por el recorte octogonal');
  let cw = clamp(0.08 * Math.min(D.Lo, D.Wo) + 4, 5, 12);
  if (D.ribs) {
    cw = Math.min(cw, (avail0 - needMin) / 2);
    if (cw < 2.5) { D.ribs = false; cw = 0; warn.push('Caja corta: se omiten los nervios de esquina para dejar sitio a la mecánica.'); }
  } else cw = 0;
  D.cw = r2(cw);
  let avail = avail0 - 2 * cw;
  if (avail < needMin) {
    // La mecánica puede invadir el inicio del radio de esquina.
    avail = Math.max(avail, D.Lo - 2 * (0.5 * D.ro + 1));
    if (avail < needMin) {
      warn.push(`Lado largo muy corto: la mecánica mínima necesita ~${Math.ceil(needMin + D.ro + 2)} mm de largo interior.`);
      avail = needMin;
    }
  }
  D.avail = r2(avail);

  // Bisagras
  let nH = P.hingeCount > 0 ? P.hingeCount : D.Lo > 300 ? 3 : Mx.hinges;
  let Lh = nH === 1 ? Math.min(0.6 * D.Lo, 70) : clamp(0.22 * D.Lo, 26, 60);
  while (nH > 1 && nH * Math.max(Lh, minHinge) + (nH - 1) * 8 > avail) nH--;
  Lh = clamp(Math.min(Lh, (avail - 8 * (nH - 1)) / nH), minHinge, 1e9);
  if (nH === 1) Lh = Math.max(Lh, Math.min(avail, 0.5 * D.Lo));   // cajas pequeñas: usa el largo disponible
  // Con 3+ bisagras y pasador impreso, la central se monta por un hueco entre
  // bisagras: ese hueco debe admitir el pasador entero (cabeza incluida).
  if (nH >= 3 && D.pinMode === 'printed') {
    const pinNeed = (len) => len + 0.2 + 1.5 + Math.max(1.6, 0.45 * D.pinD) + 3;
    const gap = (len) => { const xs = spread(nH, avail, len); return xs[1] - xs[0] - len; };
    while (Lh > minHinge + 1 && gap(Lh) < pinNeed(Lh)) Lh -= 1;
  }
  let nk = 5;
  let kl = (Lh - (nk - 1) * D.ag) / nk;
  if (kl < Math.max(minKl, 6)) { nk = 3; kl = (Lh - 2 * D.ag) / 3; }
  D.hinge = { n: nH, len: r2(Lh), nk, kl: r2(kl), xs: spread(nH, avail, Lh) };

  // Cierres
  let nL = P.latchCount > 0 ? P.latchCount : D.Lo > 300 ? 3 : Mx.latches;
  D.latchW = Mx.latchW;
  let span = D.latchW + 2 * (D.ag + D.cheekW);
  while (nL > 1 && nL * span + (nL - 1) * 10 > avail) nL--;
  if (span > avail) {
    D.cheekW = r2(Math.max(minCheek, Math.min(D.cheekW, (avail - 6) / 2 - D.ag)));
    D.latchW = r2(Math.max(6, avail - 2 * (D.ag + D.cheekW)));
    span = D.latchW + 2 * (D.ag + D.cheekW);
  }
  D.latch = { n: nL, span: r2(span), xs: spread(nL, avail, span) };

  // Margen de montaje: entre el extremo de cada mecanismo y el nervio de
  // esquina quedan ≥ 6 mm libres (tapón 2.4 + empuje 2.2 + holgura) para
  // colocar tapones y meter el filamento/pasador. Los nervios ceden.
  if (D.ribs) {
    const acc = 6;
    const maxEnd = Math.max(...D.hinge.xs.map((x) => Math.abs(x) + D.hinge.len / 2),
      ...D.latch.xs.map((x) => Math.abs(x) + D.latch.span / 2));
    const cwMax = D.Lo / 2 - D.ro - maxEnd - acc;
    if (cwMax < D.cw) {
      if (cwMax < 2.5) { D.ribs = false; D.cw = 0; D.snapped.push('nervios de esquina omitidos: dejan sitio para montar los pasadores'); }
      else { D.cw = r2(cwMax); D.snapped.push(`nervios de esquina acortados a ${D.cw} mm para montar los pasadores`); }
    }
  }

  /* ---- Lado por el que se monta cada pasador ----
   * headSide = lado de la cabeza (−1 = −X, +1 = +X): el pasador impreso entra
   * por ese lado y necesita ese tramo del eje libre en toda su longitud.
   *  - Bisagras: cabezas hacia los extremos de la caja (nunca atravesando la
   *    otra bisagra), donde el eje queda fuera de banda y nervios.
   *  - Cierres: el eje pasa bajo la banda y junto a los nervios de esquina;
   *    se elige el lado con recorrido libre suficiente (hacia el centro si
   *    hay otro cierre lejos). Si ninguno basta, la cabeza va hacia fuera y
   *    se abre un canal de montaje en el nervio de esquina (grooves).   */
  D.hinge.headSide = D.hinge.xs.map((x) => (x > 1e-6 ? 1 : -1));
  {
    const headT = Math.max(1.6, 0.45 * D.latchPinD);
    D.latch.pinLen = r2(D.latch.span + 1.2 + 0.3 + headT);
    const need = D.latch.pinLen + 3;
    const ribStart = D.ribs ? D.Lo / 2 - D.ro - D.cw : Infinity;
    const xs = D.latch.xs, h = D.latch.span / 2;
    D.latch.headSide = []; D.latch.grooves = [];
    xs.forEach((x, i) => {
      const freeL = i > 0 ? (x - h) - (xs[i - 1] + h) : (x - h) + ribStart;
      const freeR = i < xs.length - 1 ? (xs[i + 1] - h) - (x + h) : ribStart - (x + h);
      let side = freeL >= need ? -1 : freeR >= need ? 1 : 0;
      if (freeL >= need && freeR >= need) side = x > 1e-6 ? -1 : 1;   // hacia el centro
      if (!side) {
        side = x > 1e-6 ? 1 : -1;                                      // hacia fuera + canal
        if (D.latchPinMode === 'printed' && D.ribs) D.latch.grooves.push({ x: x + side * h, side });
      }
      D.latch.headSide.push(side);
    });
  }

  /* ---- Nervios de pared (modo ahorro nervado) ---- */
  D.wallRibs = P._ecoRib ? wallRibs(D, P, lw) : null;
  if (P._ecoRib && !D.wallRibs) {
    D.ecoChanges.push('sin sitio para nervios: pared de 3 líneas sin nervar');
  } else if (D.wallRibs) {
    const R = D.wallRibs;
    D.ecoChanges.push(`nervios de ${R.w}×${R.h} mm cada ${R.pitch} mm (${R.n} en total, rigidez ${Math.round(100 * R.stiff)} % de la pared ${P._ecoRib === 'stiff' ? 'normal' : 'de 4 líneas'})`);
  }

  // Rigidez a flexión de la pared frente a la de la caja sin ahorro.
  if (D.eco) {
    const R = D.wallRibs;
    D.ecoStiff = r2((R ? ribbedI(D.t, R.w, R.h, R.pitch) : D.t ** 3 / 12) / (D.t0 ** 3 / 12));
  }

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
    cornerCut: r2(D.cham),
    floorChamfer: r2(D.fc),
    lidChamfer: r2(D.fcl),
  };
  if (D.gfPlate) {
    const free = D.Db + D.Dl;
    D.inner.gridfinity = { cells: D.gfCells.length, nx: D.rot90 ? D.gfNy : D.gfNx, ny: D.rot90 ? D.gfNx : D.gfNy,
      freeHeight: r2(free), units: Math.floor((free - 0.5) / 7) };
  }

  // Calidad: 'draft' mientras se edita (vista rápida: menos segmentos, sin
  // ranuras de sombra ni ayudas de impresión), 'preview' al soltar (modelo
  // completo) y 'final' para exportar.
  D.draft = P.quality === 'draft';
  D.seg = P.quality === 'final' ? 96 : D.draft ? 20 : 40;
  // Compartimentos: D.org (tapa) y D.orgB (base, misma distribución en el
  // "marco de tapa"; el motor la gira 180° — ver orgLayout.js).
  for (const [key, side, where, OBx] of [['org', 'lid', 'la tapa', OB], ['orgB', 'base', 'la base', OBb]]) {
    let O = OBx ? orgLayout(D, P, side) : null;
    if (O && (O.cellL < 5 || O.cellW < 5 || O.depth < 3)) {
      warn.push(`Compartimentos de ${where}: celdas demasiado pequeñas (${O.cellL}×${O.cellW}×${O.depth} mm). Reduce filas/columnas o agranda la caja.`);
      O = null;
    }
    if (O && O.magnetWarn) warn.push(`Traba magnética en ${where}: ${O.magnetWarn}. Se usa la traba mecánica (clic).`);
    if (O && O.magnetInfo && O.magnetInfo.note) warn.push(`Imanes en ${where}: ${O.magnetInfo.note}.`);
    D[key] = O;
    if (!O && D.content[side] === 'org') D.content = { ...D.content, [side]: 'off' };
  }
  return D;
}

/** Radio de la cabeza del pasador impreso (pins.js usa el mismo). */
export const pinHeadR = (d) => 0.875 * d;

/** Octógono alargado (rectángulo L×W con esquinas recortadas c a 45°), antihorario. */
export function octagonPts(L, W, c) {
  const x = L / 2, y = W / 2;
  return [[-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c], [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c]];
}

/** Punto dentro de un polígono convexo antihorario (con margen m hacia dentro). */
export function insideConvex(pts, px, py, m = 0) {
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const ex = x1 - x0, ey = y1 - y0, l = Math.hypot(ex, ey);
    if ((ex * (py - y0) - ey * (px - x0)) / l < m) return false;
  }
  return true;
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

/**
 * Rigidez a flexión por mm de ancho (mm⁴/mm) de una pared de piel `t` con
 * nervios de `w` × `h` cada `p` mm por un lado (placa nervada "difuminada":
 * eje neutro común, Steiner). Flexión que curva la pared en vertical (el
 * vano corto de una pared de caja: entre fondo y banda), la que rigidizan
 * unos nervios verticales.
 */
export function ribbedI(t, w, h, p) {
  const As = t, Ar = (w * h) / p;
  const ys = t / 2, yr = t + h / 2;
  const yb = (As * ys + Ar * yr) / (As + Ar);
  return t ** 3 / 12 + As * (ys - yb) ** 2 + (w * h ** 3 / 12) / p + Ar * (yr - yb) ** 2;
}

/**
 * Nervios verticales de pared para el modo ahorro "nervado".
 * Reglas (diseño de nervios en plástico, adaptadas a FDM):
 *  - ancho = 2 líneas (≥ 50–60 % de la piel, mínimo imprimible y sin
 *    rechupes en FDM), alto = vuelo de la banda (≤ 3 × piel): la envolvente
 *    de la caja no cambia y los nervios sostienen el chaflán de la banda;
 *  - separación ≥ 2 × piel; se elige la MAYOR que iguala la rigidez de la
 *    pared maciza de 4 líneas (ribbedI), con tope de 40 mm;
 *  - nunca en las esquinas, ni frente a bisagras y cierres (± margen), ni en
 *    el camino de pasadores y tapones (se recortan alrededor de cada eje).
 * Devuelve null si no hay sitio o la banda es demasiado estrecha.
 */
function wallRibs(D, P, lw) {
  const w = r2(2 * lw), h = r2(D.bo), t = D.t;
  // Objetivo de rigidez: "ligero" = la pared maciza de 4 líneas (la de los
  // mínimos); "rígido" = la pared normal, la que tendría sin modo ahorro.
  const t4 = P._ecoRib === 'stiff' ? Math.max(D.t0, 4 * lw, 1.6) : Math.max(4 * lw, 1.6);
  if (h < 1.2 || D.stack) return null;
  const target = t4 ** 3 / 12;
  // Tope de separación: la piel entre dos nervios es una placa apoyada en
  // ellos; para que no sea más flexible que la pared original en su vano
  // (fondo → banda, H) su vano p cumple p⁴/t³ ≤ H⁴/t4³ → p ≤ H·(t/t4)^¾.
  const H = Math.max(10, D.Hb - D.bandH - D.bo);
  const pMax = clamp(H * (t / t4) ** 0.75, 12, 40);
  let pitch = 0;
  // Separación mínima: hueco entre nervios ≥ 2 × piel (regla de diseño).
  for (let p = Math.floor(pMax * 2) / 2; p >= 2 * t + w; p -= 0.5) if (ribbedI(t, w, h, p) >= target) { pitch = p; break; }
  if (!pitch) return null;
  const m = 2.5 + D.bo;                                   // margen frente a la mecánica
  const ex = D.Lo / 2 - D.ro - D.cham - 1 - w / 2, ey = D.Wo / 2 - D.ro - D.cham - 1 - w / 2;
  const spots = (half) => {
    if (half <= 0) return [];
    const n = Math.floor((2 * half) / pitch);
    const x0 = -(n * pitch) / 2;
    return Array.from({ length: n + 1 }, (_, i) => r2(x0 + i * pitch));
  };
  const blocked = (x, list, len) => list.some((xc) => Math.abs(x - xc) < len / 2 + m);
  const hingeSide = Math.sign(D.ya) || 1, latchSide = Math.sign(D.yp) || -1;
  const long = [];
  for (const side of [1, -1]) {
    for (const x of spots(ex)) {
      if (side === hingeSide && blocked(x, D.hinge.xs, D.hinge.len)) continue;
      if (side === latchSide && blocked(x, D.latch.xs, D.latch.span)) continue;
      long.push([x, side]);
    }
  }
  const short = [];
  for (const side of [1, -1]) for (const y of spots(ey)) short.push([y, side]);
  const n = long.length + short.length;
  if (!n) return null;
  // Ejes de pasadores/tapones: tubo libre a lo largo de X.
  const R = Math.max(D.capR ?? 2, pinHeadR(D.pinD), pinHeadR(D.latchPinD)) + 1.5;
  return { w, h, pitch: r2(pitch), long, short, n, axes: [[D.ya, D.za], [D.yp, D.zp]], axisR: r2(R),
    stiff: ribbedI(t, w, h, pitch) / target };
}
