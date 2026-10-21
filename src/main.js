/**
 * main.js — Interfaz: parámetros, comunicación con el motor, panel de medidas
 * y exportación.
 */
import { DEFAULTS, SCHEMA, BED_PRESETS, migrate } from './engine/params.js';
import { EngineClient } from './engineClient.js';
import { Viewer } from './viewer.js';
import { parseSVG, placeSVG } from './svg.js';
import { transformVerts, hull2D, fitAngle, tiltChoose, packPlates } from './bedfit.js';
import { stlBinary, mergeMeshes, zipStore, download } from './export.js';
import { parseContentSVG, placeContent, minAreaRect, maxCornerCut, contentFits } from './content.js';
import { optimize } from './optimizer.js';
import { rotatedExtent } from './bedfit.js';

/* ------------------------------------------------------------------ */
/*  Estado                                                            */
/* ------------------------------------------------------------------ */
const STORE = 'ruggedbox.params.v1';
const STORE_SVG = 'ruggedbox.svg.v1';
const STORE_OBJ = 'ruggedbox.content.v1';

function loadParams() {
  let saved = {};
  try {
    if (location.hash.length > 1) saved = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    else saved = JSON.parse(localStorage.getItem(STORE) || '{}');
  } catch { saved = {}; }
  saved = migrate(saved);
  const P = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (k in saved) P[k] = saved[k];
  return P;
}

const state = {
  P: loadParams(),
  svgRaw: null,
  svgName: '',
  svgText: '',
  result: null,
  layout: null,
  lastApplied: 0,
};
try {
  const s = localStorage.getItem(STORE_OBJ);
  if (s) { const o = JSON.parse(s); state.objText = o.text; state.objName = o.name; state.objRaw = parseContentSVG(o.text); }
} catch { /* contorno guardado inválido */ }
try {
  const s = localStorage.getItem(STORE_SVG);
  if (s) { const o = JSON.parse(s); state.svgText = o.text; state.svgName = o.name; state.svgRaw = parseSVG(o.text); }
} catch { /* SVG guardado inválido: se ignora */ }

const engine = new EngineClient();
const viewer = new Viewer(document.getElementById('viewport'));
const mq = matchMedia('(prefers-color-scheme: dark)');
viewer.setTheme(mq.matches);
mq.addEventListener?.('change', (e) => viewer.setTheme(e.matches));

/* ------------------------------------------------------------------ */
/*  Panel de parámetros (generado desde SCHEMA)                       */
/* ------------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

const controls = {};
function buildParams() {
  const root = $('#params');
  root.innerHTML = '';
  SCHEMA.forEach((g, gi) => {
    const body = el('div', { class: 'group-body' });
    if (g.svg) body.append(svgControl());
    if (g.gridfinity) body.append(gridfinitySnap());
    if (g.content) body.append(contentControl());
    for (const it of g.items) body.append(control(it));
    root.append(el('details', { class: 'group', ...(gi < 2 || g.svg ? { open: '' } : {}) },
      el('summary', {}, g.group), body));
  });
}

function control(it) {
  const v = state.P[it.k];
  if (it.type === 'range') {
    const range = el('input', { type: 'range', min: it.min, max: it.max, step: it.step, value: v });
    const num = el('input', { type: 'number', min: it.min, max: it.max, step: it.step, value: v });
    const sync = (val, src) => {
      const x = Math.min(it.max * 4, Math.max(it.min, Number(val)));
      if (!Number.isFinite(x)) return;
      if (src !== range) range.value = x;
      if (src !== num) num.value = x;
      setParam(it.k, x);
    };
    range.addEventListener('input', () => sync(range.value, range));
    num.addEventListener('change', () => sync(num.value, num));
    controls[it.k] = { set: (x) => { range.value = x; num.value = x; } };
    return el('div', { class: 'field' },
      el('div', { class: 'lbl' }, el('span', {}, it.label), el('span', {}, it.unit)), range, num);
  }
  if (it.type === 'select') {
    const sel = el('select', {}, it.options.map(([val, txt]) => el('option', { value: val, ...(val === v ? { selected: '' } : {}) }, txt)));
    sel.addEventListener('change', () => setParam(it.k, sel.value));
    controls[it.k] = { set: (x) => { sel.value = x; } };
    return el('div', { class: 'field sel' }, el('div', { class: 'lbl' }, it.label), sel);
  }
  const cb = el('input', { type: 'checkbox', ...(v ? { checked: '' } : {}) });
  cb.addEventListener('change', () => setParam(it.k, cb.checked));
  controls[it.k] = { set: (x) => { cb.checked = !!x; } };
  return el('label', { class: 'field tog' }, el('span', { class: 'lbl' }, it.label), cb);
}

/**
 * Contenido a medida: SVG calcado de la pieza real (en mm). Permite ajustar el
 * interior al contorno y saber cuánto se pueden recortar las esquinas.
 */
function contentControl() {
  const file = el('input', { type: 'file', accept: '.svg,image/svg+xml', hidden: '' });
  const info = el('div', { class: 'small' });
  const pick = el('button', { class: 'sm' }, 'Cargar contorno (SVG)…');
  const fit = el('button', { class: 'sm' }, 'Ajustar interior al contenido');
  const clear = el('button', { class: 'ghost sm' }, 'Quitar');
  const refresh = () => {
    const r = state.objRaw;
    fit.hidden = clear.hidden = !r;
    info.textContent = r
      ? `${state.objName}: ${r.w.toFixed(1)} × ${r.h.toFixed(1)} mm (${r.note}).`
      : 'Sube el calco de tu pieza (SVG 1:1 en mm). Se usa para dimensionar el interior y para saber cuánto se pueden recortar las esquinas sin tocarla.';
  };
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      state.objRaw = parseContentSVG(text); state.objText = text; state.objName = f.name;
      try { localStorage.setItem(STORE_OBJ, JSON.stringify({ name: f.name, text })); } catch { /* grande */ }
      refresh(); fitInterior();
    } catch (e) { alert('No se pudo leer el contorno: ' + e.message); }
    file.value = '';
  });
  fit.addEventListener('click', fitInterior);
  clear.addEventListener('click', () => {
    state.objRaw = null; state.objText = ''; state.objName = '';
    localStorage.removeItem(STORE_OBJ); refresh(); viewer.setContent(null); renderInfo();
  });
  refresh();
  return el('div', { class: 'svgbox' }, el('div', { class: 'row' }, pick, clear, file), fit, info);
}

/** Interior = rectángulo de área mínima del contenido + holgura (lado largo en X). */
function fitInterior() {
  const r = state.objRaw;
  if (!r) return;
  const m = minAreaRect(r.hull);
  const c = 2 * state.P.objClearance;
  state.P.objRotate = Math.round(((m.deg + 540) % 360 - 180) * 10) / 10;
  state.P.innerL = Math.ceil((m.w + c) * 2) / 2;
  state.P.innerW = Math.ceil((m.h + c) * 2) / 2;
  for (const k of ['objRotate', 'innerL', 'innerW']) controls[k]?.set(state.P[k]);
  setParam('innerL', state.P.innerL);
}

/** Botón: ajusta el interior a un número entero de celdas Gridfinity (+0.5 mm). */
function gridfinitySnap() {
  const b = el('button', { class: 'sm' }, 'Ajustar interior a celdas Gridfinity');
  b.addEventListener('click', () => {
    for (const k of ['innerL', 'innerW']) {
      const n = Math.max(1, Math.round((state.P[k] - 0.5) / 42));
      state.P[k] = n * 42 + 0.5;
      controls[k]?.set(state.P[k]);
    }
    setParam('gridfinity', state.P.gridfinity === 'off' ? 'baseplate' : state.P.gridfinity);
    controls.gridfinity?.set(state.P.gridfinity);
  });
  return el('div', {}, b, el('div', { class: 'small', style: 'margin-top:4px' },
    'Placa interior: los bins estándar encajan dentro. Pies: la caja se asienta sobre una placa.'));
}

function svgControl() {
  const file = el('input', { type: 'file', accept: '.svg,image/svg+xml', hidden: '' });
  const thumb = el('div', { class: 'thumb' });
  const name = el('div', { class: 'name' }, state.svgName || 'Ningún archivo');
  const clear = el('button', { class: 'ghost sm' }, 'Quitar');
  const pick = el('button', { class: 'sm' }, 'Importar SVG…');
  const refresh = () => {
    name.textContent = state.svgName || 'Ningún archivo';
    thumb.innerHTML = '';
    if (state.svgText) {
      // Miniatura: se inserta como imagen (sin ejecutar scripts del SVG).
      const img = el('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(state.svgText), alt: '' });
      img.style.cssText = 'max-width:100%;max-height:100%';
      thumb.append(img);
    }
    clear.hidden = !state.svgText;
  };
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      state.svgRaw = parseSVG(text);
      state.svgText = text;
      state.svgName = f.name;
      try { localStorage.setItem(STORE_SVG, JSON.stringify({ name: f.name, text })); } catch { /* demasiado grande */ }
      refresh();
      schedule();
    } catch (e) {
      alert('No se pudo leer el SVG: ' + e.message);
    }
    file.value = '';
  });
  clear.addEventListener('click', () => {
    state.svgRaw = null; state.svgText = ''; state.svgName = '';
    localStorage.removeItem(STORE_SVG);
    refresh(); schedule();
  });
  refresh();
  return el('div', { class: 'svgbox' },
    el('div', { class: 'row' }, thumb, el('div', { style: 'min-width:0;flex:1' }, name)),
    el('div', { class: 'row' }, pick, clear, file),
    el('div', { class: 'small' }, 'Se graba o se pone en relieve según el modo de la tapa. Usa formas con relleno; los trazos se convierten con su grosor.'));
}

function setParam(k, v) {
  state.P[k] = v;
  if (k === 'bedPreset' && v !== 'custom') {
    const b = BED_PRESETS[v];
    Object.assign(state.P, { bedX: b.x, bedY: b.y, bedZ: b.z });
    for (const kk of ['bedX', 'bedY', 'bedZ']) controls[kk]?.set(state.P[kk]);
  } else if (['bedX', 'bedY', 'bedZ'].includes(k)) {
    state.P.bedPreset = 'custom';
    controls.bedPreset?.set('custom');
  }
  try { localStorage.setItem(STORE, JSON.stringify(state.P)); } catch { /* sin almacenamiento */ }
  history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(diffFromDefaults())));
  schedule();
}

function diffFromDefaults() {
  const o = {};
  for (const [k, v] of Object.entries(state.P)) if (DEFAULTS[k] !== v) o[k] = v;
  return o;
}

/* ------------------------------------------------------------------ */
/*  Reconstrucción                                                    */
/* ------------------------------------------------------------------ */
let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 40);
}

async function rebuild() {
  const busy = $('#busy');
  const t = setTimeout(() => { busy.hidden = false; }, 150);
  const svg = placeSVG(state.svgRaw, state.P);
  const msg = await engine.request({ ...state.P, quality: 'preview' }, svg, true);
  clearTimeout(t);
  if (msg.superseded) return;
  busy.hidden = true;
  if (!msg.ok) { setStatus('err', 'Error: ' + msg.error.split('\n')[0]); console.error(msg.error); return; }
  if (msg.id < state.lastApplied) return;
  state.lastApplied = msg.id;
  state.result = msg.r;
  state.layout = computeLayout(msg.r);
  viewer.setData(msg.r, state.layout, bed());
  const tris = msg.r.parts.reduce((s, p) => s + p.tris * p.instances.length, 0);
  setStatus('ok', `${msg.r.ms} ms · ${tris.toLocaleString('es')} triángulos · clase ${msg.r.D.cls}`);
  updateContent();
  renderInfo();
  const sp = $('#sectionPos');
  sp.min = -Math.ceil(msg.r.D.Lband / 2); sp.max = Math.ceil(msg.r.D.Lband / 2);
}

/** Aplica una opción del optimizador (solo cambia los parámetros implicados). */
function applyOption(a) {
  for (const k of ['cornerCut', 'cornerRibs', 'bandProud', 'wall']) {
    if (state.P[k] !== a.P[k]) { state.P[k] = a.P[k]; controls[k]?.set(a.P[k]); }
  }
  setParam('wall', state.P.wall);
}

/** Coloca el contenido en el visor y calcula sus límites. */
function updateContent() {
  const placed = placeContent(state.objRaw, state.P);
  state.content = placed;
  viewer.setContent(placed ? placed.internal : null);
  const D = state.result?.D;
  state.cmax = placed && D ? maxCornerCut(placed.internal, D.Li, D.Wi, state.P.objClearance) : null;
  state.opt = optimize(state.P, state.cmax);
}

function setStatus(kind, text) {
  $('#status').className = 'status ' + kind;
  $('#statusText').textContent = text;
}

const bed = () => ({ x: state.P.bedX, y: state.P.bedY, z: state.P.bedZ });
const EDGE = 2; // mm libres en el borde de la cama

/** Orienta cada pieza en la cama y empaqueta todas las copias en placas. */
function computeLayout(res) {
  const B = bed();
  const fits = {};
  const items = [];
  for (const p of res.parts) {
    const xyz = transformVerts(p.mesh.vert, p.mesh.numProp, p.print);
    let zMax = 0;
    for (let i = 2; i < xyz.length; i += 3) if (xyz[i] > zMax) zMax = xyz[i];
    const hull = hull2D(xyz);
    // Margen de 2 mm por lado respecto al borde de la cama.
    const fit = fitAngle(hull, B.x - 2 * EDGE, B.y - 2 * EDGE);
    const tilt = fit.ok ? null : tiltChoose(xyz, B);
    fits[p.key] = { ...fit, tilt, tooTall: zMax > B.z, height: zMax };
    const solo = (p.aids && p.aids.length) || p.tilt;
    for (let k = 0; k < p.instances.length; k++) {
      items.push({ partId: p.key, angle: fit.angle, fit, label: p.name, solo, hull });
    }
    fits[p.key].aids = (p.aids || []).map((a) => a.name);
  }
  // Piezas con ayudas (orejas, bisel, aletas): solas y CENTRADAS en su placa,
  // que es la colocación con la que el motor recortó las ayudas a la cama.
  const solo = items.filter((it) => it.solo).map((it) => {
    const e = rotatedExtent(it.hull, it.angle);
    return { items: [{ partId: it.partId, angle: it.angle, tx: B.x / 2 - (e.x0 + e.w / 2), ty: B.y / 2 - (e.y0 + e.h / 2) }] };
  });
  const plates = packPlates(items.filter((it) => !it.solo), { x: B.x - 2 * EDGE, y: B.y - 2 * EDGE }).map((pl) => ({
    items: pl.items.map((it) => ({
      partId: it.partId, angle: it.angle,
      tx: it.x - it.fit.x0 + EDGE, ty: it.y - it.fit.y0 + EDGE,
    })),
  }));
  return { fits, plates: [...solo, ...plates] };
}

/* ------------------------------------------------------------------ */
/*  Panel de información                                              */
/* ------------------------------------------------------------------ */
const COLORS = { base: '#343a3f', lid: '#d9601a', latch: '#e8b10c', gasket: '#1fa596', hingePin: '#c8cbce', latchPin: '#c8cbce', cap: '#c8cbce' };
const mm = (v) => `${Number(v).toFixed(2).replace(/\.?0+$/, '')} mm`;

function kv(rows) {
  return el('dl', { class: 'kv' }, rows.flatMap(([k, v, hl]) => [el('dt', {}, k), el('dd', { class: hl ? 'hl' : '' }, v)]));
}

function renderInfo() {
  const { D, parts } = state.result;
  const I = D.inner;
  const info = $('#info');
  info.innerHTML = '';

  const copy = el('button', { class: 'ghost' }, 'Copiar JSON');
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(JSON.stringify(I, null, 2));
    copy.textContent = 'Copiado';
    setTimeout(() => { copy.textContent = 'Copiar JSON'; }, 1200);
  });
  info.append(el('section', { class: 'card key' },
    el('h3', {}, 'Interior para insertos', copy),
    kv([
      ['Largo × ancho', `${I.L} × ${I.W} mm`, true],
      ['inner_corner_radius', mm(I.inner_corner_radius), true],
      ['Profundidad base', mm(I.baseDepth)],
      ['Profundidad tapa', mm(I.lidDepth) + (state.P.lidMin ? ' (mín.)' : '')],
      ['Alto total cerrada', mm(I.closedHeight), true],
      ['Chaflán suelo / techo', `${I.floorChamfer} / ${I.lidChamfer} mm`],
      ...(I.gridfinity ? [['Gridfinity', `${I.gridfinity.nx}×${I.gridfinity.ny} celdas · bins hasta ${I.gridfinity.units}U`, true]] : []),
    ]),
    el('p', { class: 'small' }, `Inserto: L ≤ ${I.L - 0.4} mm, W ≤ ${I.W - 0.4} mm (0.2 mm de holgura por lado), radio ≥ ${I.inner_corner_radius} mm y chaflán inferior ≥ ${I.floorChamfer} mm.`)));

  // Contenido a medida.
  if (state.content) {
    const pc = state.content;
    const okIn = contentFits(pc, state.P);
    const cut = state.P.cornerCut || 0;
    info.append(el('section', { class: 'card' + (okIn ? '' : ' key') }, el('h3', {}, 'Contenido'),
      kv([
        ['Contorno', `${pc.w.toFixed(1)} × ${pc.h.toFixed(1)} mm`],
        ['Cabe en el interior', okIn ? 'sí' : 'NO: usa "Ajustar interior"', okIn],
        ['Recorte de esquina máx.', `${state.cmax} mm`],
        ...(cut > (state.cmax ?? 0) ? [['Aviso', `el recorte (${cut} mm) toca el contenido`]] : []),
      ])));
  }

  // Optimizador: ¿se puede imprimir plana?
  const o = state.opt;
  if (o && o.status !== 'fits') {
    const box = el('section', { class: 'card key' }, el('h3', {}, 'Imprimir plana'));
    if (o.status === 'option') {
      box.append(el('p', { class: 'small' }, 'La caja no cabe plana tal cual. Cambios mínimos que la hacen caber (sin inclinar, sin soportes):'));
      o.alts.forEach((a, i) => {
        const btn = el('button', { class: i ? 'sm' : 'sm primary' }, 'Aplicar');
        btn.addEventListener('click', () => applyOption(a));
        box.append(el('div', { style: 'display:flex;gap:8px;align-items:flex-start;margin:6px 0' },
          el('div', { style: 'flex:1' }, a.changes.join(' + '),
            el('div', { class: 'small' }, `→ ${a.fit.mode === 'diagonal' ? `diagonal ${a.fit.angle}°` : a.fit.mode}`)), btn));
      });
    } else {
      box.append(el('p', { class: 'small' }, 'No cabe plana ni con los ajustes permitidos: se imprime inclinada con bisel simétrico y aletas.'));
    }
    info.append(box);
  }

  info.append(el('section', { class: 'card' }, el('h3', {}, 'Exterior'),
    kv([['Envolvente', `${D.outerL} × ${D.outerW} × ${D.outerH} mm`], ['Pared / banda', `${D.t} / ${D.bo} mm`]])));

  const fl = D.filament || {};
  const pin = [
    fl.hinge ? `Bisagra: filamento 1.75, ${fl.hingeQty}× ${fl.hinge} mm` : `Bisagra: pasador impreso Ø${D.pinD} (acostado)`,
    fl.latch ? `cierres: filamento 1.75, ${fl.latchQty}× ${fl.latch} mm` : '',
  ].filter(Boolean).join(' · ');
  info.append(el('section', { class: 'card' }, el('h3', {}, 'Mecánica adaptativa'),
    kv([
      ['Clase', D.cls === 'S' ? 'S — pequeña' : D.cls === 'M' ? 'M — mediana' : 'L — grande'],
      ['Bisagras', `${D.hinge.n} × ${D.hinge.nk} nudillos (${D.hinge.len} mm)`],
      ['Cierres', `${D.latch.n} empotrados, ${D.latchW} mm`],
      ['Pasador cierre', D.latchPinMode === 'filament' ? 'filamento 1.75' : `impreso Ø${D.latchPinD}`],
      ['Taladro bisagra', `Ø${D.holeD} mm teardrop`],
    ]),
    el('p', { class: 'small' }, pin + (D.rot90 ? ' · Mecánica girada al lado largo.' : ''))));

  // Línea de contracción: alturas críticas detectadas y cómo se atacan.
  const hl = D.hullLine || [];
  info.append(el('section', { class: 'card' }, el('h3', {}, 'Línea de contracción'),
    hl.length ? kv(hl.map((h) => [`${h.part} z=${h.z} mm`, `−${h.drop}% · ${h.masked}`, h.masked !== 'no'])) : el('p', { class: 'small' }, 'Sin transiciones bruscas detectadas.'),
    el('p', { class: 'small' }, (D.snapped.length ? 'Ajustado a la impresora: ' + D.snapped.join(', ') + '. ' : '') +
      'z en orientación de impresión. Además: chaflán interior 45°, paredes de líneas enteras y ajustes de slicer en LEEME.txt.')));

  const seal = D.sealMode === 'tpu'
    ? [['Ranura', `${D.gw} × ${D.gd} mm`], ['Junta TPU', `${D.gkw} × ${D.gkh} mm`],
      ['Compresión', `${Math.round(D.c * 100)} %`, true], ['Llenado', `${Math.round(D.fill * 100)} % (≤ 85 %)`]]
    : D.sealMode === 'labyrinth'
      ? [['Ranuras', `2 × ${D.gw} × ${D.gd} mm`], ['Lengüetas', `${D.tl} mm, holgura ${D.clr} mm`]]
      : [['Ranura', `${D.gw} × ${D.gd} mm`], ['Lengüeta', `${D.tl} mm`]];
  info.append(el('section', { class: 'card' }, el('h3', {}, 'Sellado'), kv(seal)));

  const B = bed();
  const fitRows = parts.map((p) => {
    const f = state.layout.fits[p.key];
    let txt = f.ok ? (f.mode === 'diagonal' ? `diagonal ${f.angle}°` : f.mode) : 'no cabe plana';
    if (p.tilt) txt = `inclinada ${p.tilt.alpha}° · bisel ${p.tilt.cut} mm · ${p.tilt.finCount} aletas`;
    if (!f.ok && f.tilt?.ok) txt = `inclinar ${f.tilt.alpha}° sobre ${f.tilt.axis} + giro ${f.tilt.angle}° (soportes)`;
    if (!f.ok && !f.tilt?.ok) txt = 'no cabe: reduce medidas';
    if (f.tooTall) txt += ' · excede Z';
    if (f.aids?.length) txt += ' + ' + f.aids.map((a) => a.split(' (')[0].toLowerCase()).join(', ');
    return [p.name, txt, f.mode === 'diagonal'];
  });
  const tilted = parts.filter((p) => p.tilt);
  if (tilted.length) {
    info.append(el('section', { class: 'card key' }, el('h3', {}, 'Impresión inclinada'),
      kv(tilted.flatMap((p) => [
        [`${p.name}: ángulo`, `${p.tilt.alpha}° sobre ${p.tilt.axis}`, p.tilt.alpha === 45],
        ['Bisel de contacto', `${p.tilt.cut} mm → franja ${p.tilt.contact} mm${p.tilt.symmetric ? ' · simétrico (4 aristas)' : ''}`],
        ['Aletas', `${p.tilt.finCount} · ${(p.tilt.finVol / 1000).toFixed(1)} cm³ (${Math.round(100 * p.tilt.finVol / Math.max(1, p.tilt.wedgeVol))} % de una cuña)`],
      ])),
      el('p', { class: 'small' }, 'A 45° fondo y paredes no necesitan soporte; las aletas solo estabilizan hasta el centro de masa y tocan la pieza con dientes de 1 línea.')));
  }
  info.append(el('section', { class: 'card' },
    el('h3', {}, `Cama ${B.x}×${B.y}×${B.z}`), kv(fitRows),
    el('p', { class: 'small' }, `${state.layout.plates.length} placa(s). Ver en modo “Placas”.`)));

  info.append(el('section', { class: 'card' }, el('h3', {}, 'Piezas'),
    el('table', { class: 'parts' }, el('tbody', {}, parts.map((p) => el('tr', {},
      el('td', {}, el('span', { class: 'sw', style: `background:${COLORS[p.id]}` }), `${p.name} × ${p.instances.length}`,
        el('div', { class: 'small' }, p.material)),
      el('td', {}, `${(p.volume / 1000).toFixed(1)} cm³`)))))));

  if (D.warn.length) {
    info.append(el('section', { class: 'card' }, el('h3', {}, 'Avisos'),
      el('ul', { class: 'warn' }, D.warn.map((w) => el('li', {}, w)))));
  }
}

/* ------------------------------------------------------------------ */
/*  Exportación                                                       */
/* ------------------------------------------------------------------ */
async function finalBuild() {
  const svg = placeSVG(state.svgRaw, state.P);
  let msg;
  do { msg = await engine.request({ ...state.P, quality: 'final' }, svg, false); } while (msg.superseded);
  if (!msg.ok) throw new Error(msg.error);
  schedule(); // vuelve a la vista previa
  return msg.r;
}

/** Malla de una pieza en orientación de impresión, girada y centrada. */
function printMesh(p, angle) {
  const xyz = transformVerts(p.mesh.vert, p.mesh.numProp, p.print);
  const a = (angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
  for (let i = 0; i < xyz.length; i += 3) {
    const x = xyz[i], y = xyz[i + 1];
    xyz[i] = c * x - s * y; xyz[i + 1] = s * x + c * y;
    x0 = Math.min(x0, xyz[i]); x1 = Math.max(x1, xyz[i]);
    y0 = Math.min(y0, xyz[i + 1]); y1 = Math.max(y1, xyz[i + 1]);
    z0 = Math.min(z0, xyz[i + 2]);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (let i = 0; i < xyz.length; i += 3) { xyz[i] -= cx; xyz[i + 1] -= cy; xyz[i + 2] -= z0; }
  // Ayudas (orejas, aletas): misma rotación y desplazamiento que la pieza.
  const aids = (p.aids || []).map((ad) => {
    const v = transformVerts(ad.mesh.vert, ad.mesh.numProp, IDENT);
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i], y = v[i + 1];
      v[i] = c * x - s * y - cx; v[i + 1] = s * x + c * y - cy; v[i + 2] -= z0;
    }
    return { xyz: v, tri: ad.mesh.tri };
  });
  return { xyz, tri: p.mesh.tri, w: x1 - x0, h: y1 - y0, aids };
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const fileName = (p) => FILE[p.id] + (p.key !== p.id ? '_' + (Number(p.key.replace(/\D/g, '')) + 1) : '');
const FILE = { base: 'base', lid: 'tapa', latch: 'cierre', gasket: 'junta_TPU', hingePin: 'pasador_bisagra', latchPin: 'pasador_cierre', cap: 'tapon_pasador' };

async function exportZip() {
  const btn = $('#btnZip');
  btn.disabled = true; btn.textContent = 'Generando…';
  try {
    const r = await finalBuild();
    const layout = computeLayout(r);
    const files = [];
    for (const p of r.parts) {
      const m = printMesh(p, layout.fits[p.key].angle);
      files.push({ name: `piezas/${fileName(p)}_x${p.instances.length}.stl`, data: stlBinary(m.xyz, m.tri, p.id) });
      if (m.aids.length) {
        if (state.P.aidsInPart) {
          // Pieza + ayudas en un único STL, ya colocadas para imprimir.
          const all = mergeMeshes([{ xyz: m.xyz, tri: m.tri }, ...m.aids]);
          files[files.length - 1] = { name: `piezas/${fileName(p)}_x${p.instances.length}_con_soportes.stl`, data: stlBinary(all.xyz, all.tri, p.id) };
        } else {
          const ag = mergeMeshes(m.aids);
          files.push({ name: `piezas/${fileName(p)}_ayudas.stl`, data: stlBinary(ag.xyz, ag.tri, p.id + ' ayudas') });
        }
      }
    }
    const B = bed();
    const byId = Object.fromEntries(r.parts.map((p) => [p.key, p]));
    layout.plates.forEach((pl, k) => {
      const place = (src, it) => {
        const a = (it.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        for (let i = 0; i < src.length; i += 3) {
          const x = src[i], y = src[i + 1];
          src[i] = c * x - s * y + it.tx - B.x / 2;
          src[i + 1] = s * x + c * y + it.ty - B.y / 2;
        }
        return src;
      };
      const meshes = pl.items.flatMap((it) => {
        const p = byId[it.partId];
        const out = [{ xyz: place(transformVerts(p.mesh.vert, p.mesh.numProp, p.print), it), tri: p.mesh.tri }];
        for (const ad of p.aids || []) out.push({ xyz: place(transformVerts(ad.mesh.vert, ad.mesh.numProp, IDENT), it), tri: ad.mesh.tri });
        return out;
      });
      const mg = mergeMeshes(meshes);
      files.push({ name: `placas/placa_${k + 1}.stl`, data: stlBinary(mg.xyz, mg.tri, `placa ${k + 1}`) });
    });
    files.push({ name: 'LEEME.txt', data: readme(r, layout) });
    files.push({ name: 'parametros.json', data: JSON.stringify(state.P, null, 2) });
    files.push({ name: 'interior.json', data: JSON.stringify(r.D.inner, null, 2) });
    const I = r.D.inner;
    download(zipStore(files), `rugged-box_${I.L}x${I.W}x${I.closedHeight}.zip`);
  } catch (e) {
    alert('Error al exportar: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Exportar todo (.zip)';
  }
}

function orientText(f, p) {
  if (p.tilt) return `inclinada ${p.tilt.alpha}° sobre ${p.tilt.axis}; bisel de contacto de ${p.tilt.cut} mm (franja ${p.tilt.contact} mm); ${p.tilt.finCount} aletas de soporte (${(p.tilt.finVol / 1000).toFixed(1)} cm³, ${Math.round(100 * p.tilt.finVol / Math.max(1, p.tilt.wedgeVol))} % de una cuña maciza)`;
  if (!f.ok) return 'NO CABE en la cama';
  return f.mode + (f.mode === 'diagonal' ? ` ${f.angle}°` : '') + (f.aids?.length ? ' + ' + f.aids.join(', ') : '');
}

function readme(r, layout) {
  const D = r.D;
  const lines = [
    'RUGGED BOX — instrucciones de impresión y montaje',
    '='.repeat(50), '',
    `Interior: ${D.inner.L} × ${D.inner.W} mm, alto cerrado ${D.inner.closedHeight} mm, inner_corner_radius ${D.inner.inner_corner_radius} mm`,
    `Exterior: ${D.outerL} × ${D.outerW} × ${D.outerH} mm`, '',
    'PIEZAS (ya orientadas para imprimir, sin soportes):',
    ...r.parts.map((p) => `  - ${p.name} × ${p.instances.length}  [${p.material}]  → ${orientText(layout.fits[p.key], p)}`),
    '',
    'AJUSTES RECOMENDADOS:',
    `  - Base/tapa: capa ${D.lh} mm, ancho de pared ${D.lw} mm (la pared mide ${D.t} mm = ${Math.round(D.t / D.lw)} líneas exactas), relleno gyroid 15–25 %.`,
    '  - Línea de contracción (además del diseño): perímetro exterior primero (outer/inner),',
    '    flujo de relleno sólido 95 %, tiempo mínimo de capa 6–8 s, ventilador constante,',
    '    "asegurar grosor de pared vertical" activado y sin "solo una pared en superficies superiores".',
    '  - Ayudas (*_ayudas.stl): orejas de 2 capas en esquinas, o aletas de soporte con dientes de 1 línea; se rompen a mano.',
    '    Las aletas van en planos perpendiculares al eje de inclinación: imprímelas en el mismo objeto que la pieza.',
    '  - Cierres: imprimir acostados (como vienen), 100 % de perímetros o 5+ paredes, PETG preferible (más elástico).',
    '  - Pasadores: acostados sobre la cara plana, 100 % de relleno.',
    '  - Junta: TPU 95A, 0.2 mm, velocidad baja, 100 % de relleno.',
    '  - Tapa: la cara decorada va contra la cama.', '',
    'MONTAJE:',
    '  1. Coloca la junta TPU en la ranura de la base (si aplica).',
    '  2. Alinea los nudillos de la tapa entre los de la base e inserta el pasador por el lado de la cabeza hasta que los dientes salten.',
    '  3. Coloca cada cierre entre sus orejetas e inserta su pasador.',
  ];
  const fl = D.filament || {};
  if (fl.hinge) lines.push(`  * Bisagra: corta ${fl.hingeQty}× ${fl.hinge} mm de filamento 1.75 mm y fíjalos con los tapones a presión.`);
  if (fl.latch) lines.push(`  * Cierres: corta ${fl.latchQty}× ${fl.latch} mm de filamento 1.75 mm y fíjalos con los tapones a presión.`);
  if (D.stack) lines.push('  * Apilable: la base de una caja encaja en el marco de la tapa de otra.');
  if (D.gfPlate) lines.push(`  * Gridfinity: ${D.inner.gridfinity.nx}×${D.inner.gridfinity.ny} celdas, bins de hasta ${D.inner.gridfinity.units}U.`);
  if (D.warn.length) lines.push('', 'AVISOS:', ...D.warn.map((w) => '  ! ' + w));
  return lines.join('\r\n');
}

async function exportSingles() {
  const dlg = document.getElementById('dlgStl') || document.body.appendChild(el('dialog', { id: 'dlgStl', class: 'card' }));
  dlg.innerHTML = '';
  dlg.append(el('h3', {}, 'Descargar STL por pieza'), el('p', { class: 'small' }, 'Generando a calidad final…'));
  dlg.showModal();
  try {
    const r = await finalBuild();
    const layout = computeLayout(r);
    dlg.innerHTML = '';
    dlg.append(el('h3', {}, 'Descargar STL por pieza'));
    for (const p of r.parts) {
      dlg.append(el('div', { style: 'display:flex;justify-content:space-between;gap:16px;align-items:center;margin:6px 0' },
        el('span', {}, `${p.name} × ${p.instances.length}`),
        el('button', { class: 'sm', onclick: () => {
          const m = printMesh(p, layout.fits[p.key].angle);
          const all = state.P.aidsInPart && m.aids.length ? mergeMeshes([{ xyz: m.xyz, tri: m.tri }, ...m.aids]) : m;
          download(stlBinary(all.xyz, all.tri, p.id), `${fileName(p)}.stl`, 'model/stl');
        } }, 'STL')));
    }
    dlg.append(el('div', { style: 'text-align:right;margin-top:10px' }, el('button', { class: 'ghost sm', onclick: () => dlg.close() }, 'Cerrar')));
  } catch (e) {
    dlg.innerHTML = '';
    dlg.append(el('p', {}, 'Error: ' + e.message), el('button', { onclick: () => dlg.close() }, 'Cerrar'));
  }
}

/* ------------------------------------------------------------------ */
/*  Barra del visor                                                   */
/* ------------------------------------------------------------------ */
$('#modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  for (const x of $('#modeSeg').children) x.classList.toggle('on', x === b);
  viewer.setMode(b.dataset.mode);
});
$('#open').addEventListener('input', (e) => viewer.setOpen(Number(e.target.value)));
$('#inner').addEventListener('change', (e) => viewer.setInterior(e.target.checked));
const section = () => viewer.setSection($('#section').checked, Number($('#sectionPos').value));
$('#section').addEventListener('change', section);
$('#sectionPos').addEventListener('input', section);
$('#btnFit').addEventListener('click', () => viewer.fit());
$('#btnZip').addEventListener('click', exportZip);
$('#btnStl').addEventListener('click', exportSingles);
$('#btnReset').addEventListener('click', () => {
  if (!confirm('¿Restablecer todos los parámetros?')) return;
  state.P = { ...DEFAULTS };
  localStorage.removeItem(STORE);
  history.replaceState(null, '', location.pathname);
  buildParams();
  schedule();
});

buildParams();
rebuild();

// Acceso para depuración y pruebas automatizadas.
window.__rugged = { state, viewer, setParam };
