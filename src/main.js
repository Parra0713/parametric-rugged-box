/**
 * main.js — Interfaz: pestañas de parámetros, contenido a medida (varios
 * objetos con acomodo automático), comunicación con el motor, panel de
 * resultados y exportación.
 */
import { DEFAULTS, SCHEMA, TABS, BED_PRESETS, migrate } from './engine/params.js';
import { EngineClient } from './engineClient.js';
import { Viewer } from './viewer.js';
import { parseSVG, placeSVG } from './svg.js';
import { transformVerts, hull2D, fitAngle, tiltChoose, packPlates, rotatedExtent } from './bedfit.js';
import { stlBinary, mergeMeshes, zipStore, download } from './export.js';
import { parseContentSVG, maxCornerCut } from './content.js';
import { pack } from './packer.js';
import { optimize, fitsFlat } from './optimizer.js';
import { derive } from './engine/params.js';
import { CAL_KEYS, calibPlan, applyResults } from './engine/calib.js';
import { loadProfiles, saveProfiles, activeProfile, addProfile, removeProfile, setManual, setFromTest, resetProfile } from './calibProfile.js';

/* ------------------------------------------------------------------ */
/*  Estado                                                            */
/* ------------------------------------------------------------------ */
const STORE = 'ruggedbox.params.v1';
const STORE_SVG = 'ruggedbox.svg.v1';
const STORE_OBJ = 'ruggedbox.content.v1';      // v4: un solo objeto (se migra)
const STORE_OBJS = 'ruggedbox.objects.v1';     // v6: lista de objetos
const STORE_UI = 'ruggedbox.ui.v1';

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const safeDel = (k) => { try { localStorage.removeItem(k); } catch { /* idem */ } };

function loadParams() {
  let saved = {};
  try {
    if (location.hash.length > 1) saved = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    else saved = JSON.parse(safeGet(STORE) || '{}');
  } catch { saved = {}; }
  saved = migrate(saved);
  const P = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (k in saved) P[k] = saved[k];
  return P;
}

const ui = (() => { try { return { tab: 'caja', expert: false, open: {}, ...JSON.parse(safeGet(STORE_UI) || '{}') }; } catch { return { tab: 'caja', expert: false, open: {} }; } })();
const saveUi = () => safeSet(STORE_UI, JSON.stringify(ui));

const state = {
  P: loadParams(),
  calib: null,              // perfiles de calibración de holguras
  calibView: false,         // el visor muestra el test de holguras
  calibResult: null, calibMsg: null,
  svgRaw: null, svgName: '', svgText: '',
  objects: [],              // [{ name, text, raw, qty }]
  packed: null,             // resultado del acomodo
  result: null, layout: null,
};

// Objetos guardados (y migración del contorno único de la v4).
try {
  const list = JSON.parse(safeGet(STORE_OBJS) || 'null');
  if (Array.isArray(list)) state.objects = list.map((o) => ({ ...o, raw: parseContentSVG(o.text) }));
  else {
    const one = JSON.parse(safeGet(STORE_OBJ) || 'null');
    if (one) state.objects = [{ name: one.name, text: one.text, qty: 1, raw: parseContentSVG(one.text) }];
  }
} catch { state.objects = []; }
try {
  const s = safeGet(STORE_SVG);
  if (s) { const o = JSON.parse(s); state.svgText = o.text; state.svgName = o.name; state.svgRaw = parseSVG(o.text); }
} catch { /* SVG guardado inválido: se ignora */ }

// Perfil de calibración: sus valores mandan sobre los de la caja (son de la
// impresora). Al primer arranque se crea con lo que hubiera guardado.
state.calib = loadProfiles(state.P);
function applyProfile() {
  const v = activeProfile(state.calib).values;
  for (const k of CAL_KEYS) state.P[k] = v[k];
}
applyProfile();

const saveObjects = () => safeSet(STORE_OBJS, JSON.stringify(state.objects.map(({ name, text, qty }) => ({ name, text, qty }))));

const engine = new EngineClient();
const viewer = new Viewer(document.getElementById('viewport'));
const mq = matchMedia('(prefers-color-scheme: dark)');
viewer.setTheme(mq.matches);
mq.addEventListener?.('change', (e) => viewer.setTheme(e.matches));

/* ------------------------------------------------------------------ */
/*  Utilidades DOM                                                    */
/* ------------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

/* ------------------------------------------------------------------ */
/*  Panel de parámetros: pestañas + grupos + modo experto             */
/* ------------------------------------------------------------------ */
const controls = {};

function buildParams() {
  const root = $('#params');
  root.innerHTML = '';
  // Barra de pestañas (flujo de trabajo) + interruptor de modo experto.
  const bar = el('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label, title]) =>
    el('button', { class: 'tab' + (ui.tab === id ? ' on' : ''), role: 'tab', title, 'aria-selected': String(ui.tab === id),
      onclick: () => { ui.tab = id; saveUi(); buildParams(); } }, label)));
  const expert = el('label', { class: 'expert' },
    el('input', { type: 'checkbox', ...(ui.expert ? { checked: '' } : {}), onchange: (e) => { ui.expert = e.target.checked; saveUi(); buildParams(); } }),
    'Modo experto');
  const [, , subtitle] = TABS.find(([id]) => id === ui.tab) || TABS[0];
  root.append(el('div', { class: 'tabhead' }, bar, el('div', { class: 'tabsub' }, el('span', {}, subtitle), expert)));

  for (const g of SCHEMA.filter((x) => x.tab === ui.tab)) {
    const body = el('div', { class: 'group-body' });
    if (g.content) body.append(contentControl());
    if (g.svg) body.append(svgControl());
    if (g.gridfinity) body.append(gridfinitySnap());
    if (g.calib) body.append(calibControl());
    const items = g.items.filter((it) => ui.expert || !it.adv);
    for (const it of items) body.append(control(it));
    const hidden = g.items.length - items.length;
    if (hidden) body.append(el('button', { class: 'linkbtn', onclick: () => { ui.expert = true; saveUi(); buildParams(); } },
      `+ ${hidden} ajuste${hidden > 1 ? 's' : ''} avanzado${hidden > 1 ? 's' : ''}`));
    const key = g.group;
    const open = ui.open[key] !== false;
    const det = el('details', { class: 'group', ...(open ? { open: '' } : {}) }, el('summary', {}, g.group), body);
    det.addEventListener('toggle', () => { ui.open[key] = det.open; saveUi(); });
    root.append(det);
  }
}

function control(it) {
  const v = state.P[it.k];
  const hint = it.hint ? el('div', { class: 'hint' }, it.hint) : null;
  if (it.type === 'range') {
    const range = el('input', { type: 'range', min: it.min, max: it.max, step: it.step, value: v, 'aria-label': it.label });
    const num = el('input', { type: 'number', min: it.min, max: it.max, step: it.step, value: v, 'aria-label': it.label });
    const sync = (val, src) => {
      const x = Math.min(it.max * 4, Math.max(it.min, Number(val)));
      if (!Number.isFinite(x)) return;
      if (src !== range) range.value = x;
      if (src !== num) num.value = x;
      setParam(it.k, x);
    };
    range.addEventListener('input', () => sync(range.value, range));
    // El campo numérico se aplica mientras se escribe (antes solo al salir
    // del campo, y parecía que el cambio no se aplicaba). Valores a medio
    // escribir o fuera de rango se ignoran hasta confirmar con Intro/salir.
    num.addEventListener('input', () => {
      const x = Number(num.value);
      if (num.value === '' || !Number.isFinite(x) || x < it.min || x > it.max * 4) return;
      range.value = x;
      if (state.P[it.k] !== x) setParam(it.k, x);
    });
    num.addEventListener('change', () => sync(num.value, num));
    controls[it.k] = { set: (x) => { range.value = x; num.value = x; } };
    return el('div', { class: 'field' },
      el('div', { class: 'lbl' }, el('span', {}, it.label, it.cal ? calTag(it.k) : null), el('span', { class: 'unit' }, it.unit)), range, num, hint);
  }
  if (it.type === 'select') {
    const sel = el('select', { 'aria-label': it.label }, it.options.map(([val, txt]) => el('option', { value: val, ...(String(val) === String(v) ? { selected: '' } : {}) }, txt)));
    sel.addEventListener('change', () => setParam(it.k, sel.value));
    controls[it.k] = { set: (x) => { sel.value = x; } };
    return el('div', { class: 'field sel' }, el('div', { class: 'lbl' }, it.label), sel, hint);
  }
  const cb = el('input', { type: 'checkbox', ...(v ? { checked: '' } : {}) });
  cb.addEventListener('change', () => setParam(it.k, cb.checked));
  controls[it.k] = { set: (x) => { cb.checked = !!x; } };
  return el('label', { class: 'field tog' }, el('span', { class: 'lbl' }, it.label), cb, hint);
}

/* ------------------------------------------------------------------ */
/*  Contenido: varios objetos (calcos SVG 1:1) con acomodo automático */
/* ------------------------------------------------------------------ */
function contentControl() {
  const file = el('input', { type: 'file', accept: '.svg,image/svg+xml', multiple: '', hidden: '' });
  const add = el('button', { class: 'sm primary' }, '+ Añadir objetos (SVG)');
  add.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const errs = [];
    for (const f of file.files) {
      try {
        const text = await f.text();
        state.objects.push({ name: f.name.replace(/\.svg$/i, ''), text, qty: 1, raw: parseContentSVG(text) });
      } catch (e) { errs.push(`${f.name}: ${e.message}`); }
    }
    file.value = '';
    if (errs.length) alert('No se pudieron leer:\n' + errs.join('\n'));
    // Con objetos, lo natural es un inserto con sus huecos.
    if (state.objects.length && state.P.insertMode === 'off') { state.P.insertMode = 'pockets'; controls.insertMode?.set('pockets'); }
    saveObjects();
    buildParams();
    contentChanged();
  });

  const list = el('div', { class: 'objlist' });
  if (!state.objects.length) {
    list.append(el('div', { class: 'empty' },
      el('b', {}, 'Sin objetos.'), ' Sube el calco de cada pieza (SVG a escala 1:1 en mm). ',
      'Se acomodan solos para ocupar el mínimo espacio y el inserto les deja su hueco y huecos para los dedos.'));
  }
  state.objects.forEach((o, i) => {
    const thumb = el('div', { class: 'thumb' }, el('img', { alt: '', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(o.text) }));
    const qty = el('div', { class: 'qty' },
      el('span', { class: 'small' }, 'Cantidad'),
      el('button', { class: 'ghost sm', 'aria-label': 'Menos', onclick: () => { o.qty = Math.max(1, o.qty - 1); saveObjects(); buildParams(); contentChanged(); } }, '−'),
      el('span', {}, String(o.qty)),
      el('button', { class: 'ghost sm', 'aria-label': 'Más', onclick: () => { o.qty = Math.min(50, o.qty + 1); saveObjects(); buildParams(); contentChanged(); } }, '+'));
    const del = el('button', { class: 'ghost sm', title: 'Quitar', 'aria-label': 'Quitar', onclick: () => { state.objects.splice(i, 1); saveObjects(); buildParams(); contentChanged(); } }, '✕');
    list.append(el('div', { class: 'obj' }, thumb,
      el('div', { class: 'objinfo' }, el('div', { class: 'name' }, o.name), el('div', { class: 'small' }, `${o.raw.w.toFixed(1)} × ${o.raw.h.toFixed(1)} mm`)),
      qty, del));
  });
  const status = el('div', { class: 'small packinfo', id: 'packInfo' }, packText());
  const again = state.objects.length ? el('button', { class: 'sm', onclick: () => { contentChanged(true); } }, 'Reorganizar') : null;
  return el('div', { class: 'svgbox' }, el('div', { class: 'row' }, add, again, file), list, status);
}

function packText() {
  const k = state.packed;
  if (!state.objects.length) return '';
  if (!k) return 'No caben con estas medidas: aumenta la caja o usa "Ajustarlo al contenido".';
  const n = k.placed.length;
  return `${n} pieza${n > 1 ? 's' : ''} acomodada${n > 1 ? 's' : ''} en ${k.w.toFixed(0)} × ${k.h.toFixed(0)} mm (${k.ms} ms).`;
}

/** Margen entre la huella del contenido y la cara interior de la caja. */
function contentMargin() {
  const P = state.P;
  return (P.insertTol ?? 0.3) + 2 * P.lineWidth + 0.8 + (P.objClearance || 0);
}

/**
 * Recalcula el acomodo. Con "Ajustarlo al contenido" la caja toma el tamaño
 * del acomodo (+ márgenes); en manual se acomoda dentro de las medidas dadas.
 */
let packKey = '';
function runPack(force) {
  const P = state.P;
  if (!state.objects.length) { state.packed = null; packKey = ''; return; }
  const m = contentMargin();
  const manual = P.contentFit === 'manual';
  const L = Math.max(P.innerL, P.innerW), W = Math.min(P.innerL, P.innerW);
  const opt = {
    spacing: P.objSpacing, pocketTol: P.pocketTol, fingerCount: P.insertMode === 'pockets' ? P.fingerCount : '0',
    fingerD: P.fingerD, fingerPos: P.fingerPos, rotate: P.objRotateAllow,
    ...(manual ? { stripW: L - 2 * m, maxH: W - 2 * m } : {}),
  };
  // ¿Cabe plana la caja que resultaría de un acomodo w × h? (huella exacta
  // de la caja con su mecánica; cuesta ~1 ms y se cachea por tamaño).
  const fitCache = new Map();
  opt.fitsBed = (w, h) => {
    const k2 = `${Math.round(w)}x${Math.round(h)}`;
    if (!fitCache.has(k2)) fitCache.set(k2, fitsFlat(derive({ ...P, innerL: w + 2 * m, innerW: h + 2 * m }), { x: P.bedX, y: P.bedY }).ok);
    return fitCache.get(k2);
  };
  const key = JSON.stringify([state.objects.map((o) => [o.name, o.qty, o.raw.w, o.raw.h]), opt, P.bedX, P.bedY, P.wall, P.cornerCut]);
  if (!force && key === packKey) return;
  packKey = key;
  state.packed = pack(state.objects.map((o) => ({ polys: o.raw.polys, qty: o.qty })), opt);
  if (state.packed && !manual) {
    const nl = Math.ceil((state.packed.w + 2 * m) * 2) / 2, nw = Math.ceil((state.packed.h + 2 * m) * 2) / 2;
    if (nl !== P.innerL || nw !== P.innerW) {
      P.innerL = nl; P.innerW = nw;
      controls.innerL?.set(nl); controls.innerW?.set(nw);
    }
  }
}

/** El contenido acomodado en el marco interno del motor (lado largo en X). */
function contentPayload() {
  const k = state.packed;
  if (!k) return { contentObjects: null };
  const rot = state.P.innerW > state.P.innerL;
  const f = rot ? ([x, y]) => [y, -x] : (p) => p;
  return { contentObjects: k.placed.map((q) => ({ polys: q.polys.map((p) => p.map(f)), notches: q.notches.map(f) })) };
}

function contentChanged(force) {
  runPack(force);
  const pi = $('#packInfo');
  if (pi) pi.textContent = packText();
  setParam('innerL', state.P.innerL);
}

/** Botón: ajusta el interior a un número entero de celdas Gridfinity (+0.5 mm). */
function gridfinitySnap() {
  const b = el('button', { class: 'sm' }, 'Ajustar el interior a celdas Gridfinity');
  b.addEventListener('click', () => {
    for (const k of ['innerL', 'innerW']) {
      const n = Math.max(1, Math.round((state.P[k] - 0.5) / 42));
      state.P[k] = n * 42 + 0.5;
      controls[k]?.set(state.P[k]);
    }
    setParam('gridfinity', state.P.gridfinity === 'off' ? 'baseplate' : state.P.gridfinity);
    controls.gridfinity?.set(state.P.gridfinity);
  });
  return b;
}

function svgControl() {
  const file = el('input', { type: 'file', accept: '.svg,image/svg+xml', hidden: '' });
  const thumb = el('div', { class: 'thumb' });
  const name = el('div', { class: 'name' }, state.svgName || 'Sin logo');
  const clear = el('button', { class: 'ghost sm' }, 'Quitar');
  const pick = el('button', { class: 'sm' }, 'Elegir SVG…');
  const refresh = () => {
    name.textContent = state.svgName || 'Sin logo';
    thumb.innerHTML = '';
    if (state.svgText) {
      // Miniatura: se inserta como imagen (sin ejecutar scripts del SVG).
      thumb.append(el('img', { alt: '', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(state.svgText) }));
    }
    clear.hidden = !state.svgText;
  };
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      state.svgRaw = parseSVG(text); state.svgText = text; state.svgName = f.name;
      safeSet(STORE_SVG, JSON.stringify({ name: f.name, text }));
      refresh(); schedule();
    } catch (e) { alert('No se pudo leer el SVG: ' + e.message); }
    file.value = '';
  });
  clear.addEventListener('click', () => {
    state.svgRaw = null; state.svgText = ''; state.svgName = '';
    safeDel(STORE_SVG); refresh(); schedule();
  });
  refresh();
  return el('div', { class: 'svgbox' },
    el('div', { class: 'row' }, thumb, el('div', { style: 'min-width:0;flex:1' }, name), pick, clear, file),
    el('div', { class: 'small' }, 'Se graba (o en relieve) en la tapa. Usa formas con relleno; los trazos se convierten con su grosor.'));
}

/* ------------------------------------------------------------------ */
/*  Parámetros                                                        */
/* ------------------------------------------------------------------ */
const PACK_KEYS = new Set(['bedPreset', 'bedX', 'bedY', 'objSpacing', 'pocketTol', 'fingerCount', 'fingerD', 'fingerPos', 'objRotateAllow', 'contentFit', 'insertMode', 'objClearance', 'insertTol']);

function setParam(k, v) {
  state.P[k] = v;
  if (CAL_KEYS.includes(k)) { setManual(state.calib, k, v); refreshCalTags(); }
  if (k === 'bedPreset' && v !== 'custom') {
    const b = BED_PRESETS[v];
    Object.assign(state.P, { bedX: b.x, bedY: b.y, bedZ: b.z });
    for (const kk of ['bedX', 'bedY', 'bedZ']) controls[kk]?.set(state.P[kk]);
  } else if (['bedX', 'bedY', 'bedZ'].includes(k)) {
    state.P.bedPreset = 'custom';
    controls.bedPreset?.set('custom');
  }
  if (PACK_KEYS.has(k) || (state.P.contentFit === 'manual' && (k === 'innerL' || k === 'innerW'))) {
    runPack();
    const pi = $('#packInfo');
    if (pi) pi.textContent = packText();
  }
  schedule();
  persistSoon();
}

/*
 * Guardar en localStorage y en la URL en cada evento del deslizador (60/s)
 * es caro y los navegadores limitan history.replaceState (Safari lanza una
 * excepción tras 100 llamadas en 30 s, Chrome las ignora): se agrupa.
 */
let persistTimer = 0;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const own = { ...state.P };
    for (const k of CAL_KEYS) delete own[k];                // van en el perfil, no en la caja
    safeSet(STORE, JSON.stringify(own));
    try { history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(diffFromDefaults()))); } catch { /* límite del navegador */ }
  }, 400);
}

function diffFromDefaults() {
  const o = {};
  for (const [k, v] of Object.entries(state.P)) if (DEFAULTS[k] !== v && !CAL_KEYS.includes(k)) o[k] = v;
  return o;
}

/* ------------------------------------------------------------------ */
/*  Reconstrucción                                                    */
/* ------------------------------------------------------------------ */
/*
 * Dos pasadas por cada cambio:
 *   1. Vista rápida ('draft', dos hilos en paralelo): sale en el siguiente
 *      fotograma, con menos segmentos y sin ayudas de impresión.
 *   2. Modelo completo ('preview', tercer hilo) cuando el usuario lleva un
 *      momento sin tocar nada. Sustituye a la vista rápida sin parpadeo.
 * `rev` numera los cambios: nunca se muestra un resultado más viejo que el
 * que ya está en pantalla (ni una vista rápida encima del modelo completo de
 * la misma revisión).
 */
let rev = 0;
let shown = { rev: -1, full: false };
let draftRaf = 0, fullTimer = 0;
const FULL_DELAY = 280; // ms sin cambios antes de calcular el modelo completo

function schedule() {
  rev++;
  cancelAnimationFrame(draftRaf);
  draftRaf = requestAnimationFrame(rebuildDraft);
  clearTimeout(fullTimer);
  fullTimer = setTimeout(rebuildFull, FULL_DELAY);
  updateBusy();
}

function payload() {
  return { P: { ...state.P, ...contentPayload() }, svg: placeSVG(state.svgRaw, state.P) };
}

async function rebuildDraft() {
  // En la vista de placas la vista rápida no sirve (sin inclinación ni
  // ayudas): se espera al modelo completo.
  if (viewer.mode === 'print' && state.result) return;
  const my = rev;
  const { P, svg } = payload();
  const msg = await engine.draft(P, svg);
  if (msg.superseded) return;
  apply(msg, my, false);
}


async function rebuildFull() {
  const my = rev;
  const { P, svg } = payload();
  const msg = await engine.refine(P, svg);
  if (msg.superseded) return;
  apply(msg, my, true);
}

function apply(msg, r, full) {
  if (r < shown.rev || (r === shown.rev && shown.full && !full)) { updateBusy(); return; }
  if (!msg.ok) {
    // Un error de la vista rápida se ignora si el modelo completo va a llegar.
    if (!full && r === rev) { updateBusy(); return; }
    setStatus('err', 'Error: ' + msg.error.split('\n')[0]); console.error(msg.error);
    shown = { rev: r, full };
    updateBusy();
    return;
  }
  shown = { rev: r, full };
  const t0 = performance.now();
  state.result = msg.r;
  state.layout = computeLayout(msg.r);
  if (!state.calibView) viewer.setData(msg.r, state.layout, bed(), contentPolys());
  const tris = msg.r.parts.reduce((s, p) => s + p.tris * p.instances.length, 0);
  if (full) {
    updateContent();
    renderInfo();
  } else {
    renderInfoLight();
  }
  const sp = $('#sectionPos');
  sp.min = -Math.ceil(msg.r.D.Lband / 2); sp.max = Math.ceil(msg.r.D.Lband / 2);
  const ui = Math.round(performance.now() - t0);
  setStatus('ok', `${full ? 'Modelo completo' : 'Vista rápida'} · ${msg.r.ms} ms motor + ${ui} ms vista · ${tris.toLocaleString('es')} triángulos`);
  updateBusy();
}

/** Indicador: "Calculando…" si lo visible está desfasado; "Refinando…" si es la vista rápida. */
function updateBusy() {
  const busy = $('#busy');
  if (shown.rev < rev) { busy.textContent = 'Calculando…'; busy.hidden = false; busy.dataset.kind = 'calc'; }
  else if (!shown.full) { busy.textContent = 'Vista rápida · refinando…'; busy.hidden = false; busy.dataset.kind = 'draft'; }
  else busy.hidden = true;
}

/** Contorno del contenido para el visor (marco interno). */
function contentPolys() {
  const pay = contentPayload().contentObjects;
  return pay ? pay.flatMap((q) => q.polys) : null;
}

/** Aplica una opción del optimizador (solo cambia los parámetros implicados). */
function applyOption(a) {
  for (const k of ['cornerCut', 'cornerRibs', 'bandProud', 'wall']) {
    if (state.P[k] !== a.P[k]) { state.P[k] = a.P[k]; controls[k]?.set(a.P[k]); }
  }
  setParam('wall', state.P.wall);
}

/** Contenido en el visor + recorte de esquina máximo + optimizador de cama. */
function updateContent() {
  const D = state.result?.D;
  const fp = state.packed?.footprint;
  const rot = state.P.innerW > state.P.innerL;
  const fpi = fp ? (rot ? fp.map((p) => p.map(([x, y]) => [y, -x])) : fp) : null;
  state.cmax = fpi && D ? maxCornerCut(fpi, D.Li, D.Wi, contentMargin() - 0.5) : null;
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
/*  Panel de resultados                                               */
/* ------------------------------------------------------------------ */
const COLORS = { insert: '#7fb3d5', insertLid: '#a9cce3', orgPanel: '#9fd3c7', base: '#343a3f', lid: '#d9601a', latch: '#e8b10c', gasket: '#1fa596', hingePin: '#c8cbce', latchPin: '#c8cbce', cap: '#c8cbce' };
const mm = (v) => `${Number(v).toFixed(2).replace(/\.?0+$/, '')} mm`;

function kv(rows) {
  return el('dl', { class: 'kv' }, rows.flatMap(([k, v, hl]) => [el('dt', {}, k), el('dd', { class: hl ? 'hl' : '' }, v)]));
}

/** Tarjeta plegable con estado recordado. */
function fold(id, title, ...body) {
  const open = ui.open['info:' + id] === true;
  const d = el('details', { class: 'card fold', ...(open ? { open: '' } : {}) }, el('summary', {}, title), ...body);
  d.addEventListener('toggle', () => { ui.open['info:' + id] = d.open; saveUi(); });
  return d;
}

function orientShort(p) {
  const f = state.layout.fits[p.key];
  if (p.tilt) return `inclinada ${p.tilt.alpha}°`;
  if (!f.ok) return 'no cabe';
  return f.mode === 'diagonal' ? `diagonal ${Math.round(f.angle)}°` : f.mode;
}

/** Vista rápida: el panel de medidas se marca como pendiente hasta el modelo completo. */
function renderInfoLight() {
  $('#info').classList.add('stale');
}

/**
 * Ajustes del laminador para el modo ahorro: la pared ya es un número exacto
 * de líneas (todo perímetro, sin relleno) y fondo/techo un número exacto de
 * capas, así que basta un relleno bajo para las zonas gruesas (mecánica,
 * banda, nervios). Mismos valores en la ficha y en el LEEME.
 */
function ecoSlicer(D) {
  const per = Math.max(2, Math.round(D.t / D.lw));
  const shell = Math.max(3, Math.ceil(Math.min(D.floor ?? 1, D.topT ?? 1) / D.lh - 1e-6));
  return [
    ['Perímetros', `${per} (pared de ${D.t} mm = todo perímetro)`],
    ['Capas sup./inf.', `${shell} (fondo y techo macizos)`],
    ['Relleno', '8–10 % giroide (solo mecánica y banda)'],
    ['Cierres y pasadores', 'como siempre: no ahorrar aquí'],
  ];
}

/** Gramos (PLA) de un resultado. */
const grams = (parts) => Math.round(parts.reduce((s, p) => s + p.volume * p.instances.length, 0) / 1000 * 1.24);
/** Firma de la caja sin el modo ahorro (para comparar con/sin). */
const ecoSig = () => JSON.stringify({ ...state.P, eco: false, ecoDesign: null, ...contentPayload() });

function renderInfo() {
  const { D, parts } = state.result;
  // Material sin el modo ahorro para la misma caja (el último modelo
  // completo sin ahorro con los mismos parámetros).
  if (!D.eco) state.ecoRef = { sig: ecoSig(), g: grams(parts) };
  $('#info').classList.remove('stale');
  const I = D.inner;
  const info = $('#info');
  info.innerHTML = '';

  /* --- Resumen --- */
  const big = parts.filter((p) => ['base', 'lid', 'insert', 'insertLid'].includes(p.id));
  const tilted = parts.filter((p) => p.tilt);
  const diag = big.some((p) => !p.tilt && state.layout.fits[p.key]?.mode === 'diagonal');
  const printChip = tilted.length ? ['warn', 'Impresión inclinada'] : diag ? ['ok', 'Cabe en diagonal'] : ['ok', 'Cabe plana'];
  const vol = parts.reduce((s, p) => s + p.volume * p.instances.length, 0);
  info.append(el('section', { class: 'card summary' },
    el('div', { class: 'chips' },
      el('span', { class: 'chip ' + printChip[0] }, printChip[1]),
      el('span', { class: 'chip' }, `${state.layout.plates.length} placa${state.layout.plates.length > 1 ? 's' : ''}`),
      D.warn.length ? el('span', { class: 'chip warn' }, `${D.warn.length} aviso${D.warn.length > 1 ? 's' : ''}`) : null,
      unmeasured().length
        ? el('button', { class: 'chip warn chipbtn', title: 'Abrir la calibración de holguras', onclick: () => { ui.tab = 'impresion'; saveUi(); buildParams(); } }, 'Holguras sin medir')
        : el('span', { class: 'chip ok', title: activeProfile(state.calib).name }, 'Holguras medidas')),
    kv([
      ['Interior', `${I.L} × ${I.W} mm`, true],
      ['Profundidad', `${I.baseDepth} + ${I.lidDepth} mm`],
      ['Exterior', `${D.outerL} × ${D.outerW} × ${D.outerH} mm`],
      ['Material (aprox.)', `${(vol / 1000).toFixed(0)} cm³ · ${Math.round(vol / 1000 * 1.24)} g PLA`],
      ...(D.org ? [['Organizador', `${D.org.cols}×${D.org.rows} celdas de ${D.org.cellL}×${D.org.cellW}×${D.org.depth} mm`, true],
        ['Tapa interior', { single: 'una para todo', row: `una por fila (${D.org.panels.length})`, cell: `una por celda (${D.org.panels.length})`, none: 'sin tapa interior' }[D.org.cover]]] : []),
    ])));

  /* --- Modo ahorro --- */
  if (D.eco) {
    const g = grams(parts);
    const ref = state.ecoRef && state.ecoRef.sig === ecoSig() ? state.ecoRef.g : null;
    info.append(el('section', { class: 'card key' }, el('h3', {}, 'Modo ahorro de material'),
      kv([
        ...(ref ? [['Ahorro', `${ref - g} g (−${Math.round(100 * (1 - g / ref))} %) · ${ref} → ${g} g`, true]] : []),
        ['Cambios', D.ecoChanges.length ? D.ecoChanges.join(' · ') : 'ya estaba en mínimos'],
        ...(D.ecoStiff != null ? [['Rigidez de la pared', `${Math.round(100 * D.ecoStiff)} % de la caja normal${D.ecoStiff < 0.6 ? ' (el diseño "Nervado rígido" la recupera con menos material)' : ''}`, D.ecoStiff >= 0.95]] : []),
        ...ecoSlicer(D),
      ]),
      el('p', { class: 'small' }, 'Bisagras, cierres, junta y holguras calibradas no cambian: cierra y sella igual.')));
  }

  /* --- Avisos --- */
  if (D.warn.length) {
    info.append(el('section', { class: 'card alert' }, el('h3', {}, 'Avisos'),
      el('ul', { class: 'warn' }, D.warn.map((w) => el('li', {}, w)))));
  }

  /* --- Acciones sugeridas: imprimir plana --- */
  const o = state.opt;
  if (o && o.status === 'option') {
    const box = el('section', { class: 'card key' }, el('h3', {}, 'Puede imprimirse plana'),
      el('p', { class: 'small' }, 'Cambios mínimos para que quepa sin inclinar ni soportes:'));
    o.alts.forEach((a, i) => {
      const btn = el('button', { class: i ? 'sm' : 'sm primary' }, 'Aplicar');
      btn.addEventListener('click', () => applyOption(a));
      box.append(el('div', { class: 'opt' },
        el('div', { style: 'flex:1' }, a.changes.join(' + '),
          el('div', { class: 'small' }, `→ ${a.fit.mode === 'diagonal' ? `diagonal ${Math.round(a.fit.angle)}°` : a.fit.mode}`)), btn));
    });
    info.append(box);
  }

  /* --- Contenido --- */
  if (state.objects.length) {
    const k = state.packed;
    const n = state.objects.reduce((s, x) => s + x.qty, 0);
    info.append(el('section', { class: 'card' + (k ? '' : ' alert') }, el('h3', {}, 'Contenido'),
      kv([
        ['Objetos', `${n} (${state.objects.length} tipo${state.objects.length > 1 ? 's' : ''})`],
        ['Acomodo', k ? `${k.w.toFixed(0)} × ${k.h.toFixed(0)} mm` : 'no caben', !!k],
        ['Inserto', state.P.insertMode === 'pockets' ? `${D.insert?.pockets ?? 0} huecos · ${D.insert?.notches.length ?? 0} para dedos` : state.P.insertMode === 'blank' ? 'en blanco' : 'sin inserto'],
        ['Recorte máx. de esquina', state.cmax != null ? `${state.cmax} mm` : '—'],
      ])));
  }

  /* --- Detalles plegables --- */
  const copy = el('button', { class: 'ghost sm' }, 'Copiar JSON');
  copy.addEventListener('click', (e) => {
    e.preventDefault();
    navigator.clipboard?.writeText(JSON.stringify(I, null, 2));
    copy.textContent = 'Copiado';
    setTimeout(() => { copy.textContent = 'Copiar JSON'; }, 1200);
  });
  info.append(fold('inner', 'Medidas para diseñar insertos',
    kv([
      ['Largo × ancho', `${I.L} × ${I.W} mm`, true],
      ['Radio de esquina', mm(I.inner_corner_radius), true],
      ['Profundidad base / tapa', `${I.baseDepth} / ${I.lidDepth} mm`],
      ['Alto total cerrada', mm(I.closedHeight), true],
      ['Chaflán suelo / techo', `${I.floorChamfer} / ${I.lidChamfer} mm`],
      ...(I.cornerCut ? [['Esquinas recortadas', mm(I.cornerCut)]] : []),
      ...(I.gridfinity ? [['Gridfinity', `${I.gridfinity.cells} celdas · bins hasta ${I.gridfinity.units}U`, true]] : []),
    ]),
    el('p', { class: 'small' }, `Inserto propio: L ≤ ${I.L - 0.4}, W ≤ ${I.W - 0.4} mm, radio ≥ ${I.inner_corner_radius} mm y chaflán inferior ≥ ${I.floorChamfer} mm.`),
    el('div', { style: 'text-align:right' }, copy)));

  const B = bed();
  info.append(fold('bed', `Impresión · cama ${B.x}×${B.y}`,
    kv(parts.map((p) => [`${p.name}${p.instances.length > 1 ? ' ×' + p.instances.length : ''}`, orientShort(p) +
      ((state.layout.fits[p.key].aids || []).length ? ' + ayudas' : '')])),
    ...tilted.map((p) => el('p', { class: 'small' },
      `${p.name}: ${p.tilt.alpha}° sobre ${p.tilt.axis}, bisel ${p.tilt.cut} mm (franja ${p.tilt.contact} mm), ${p.tilt.finCount} aletas ` +
      `(${Math.round(100 * p.tilt.finVol / Math.max(1, p.tilt.wedgeVol))} % de una cuña)` + (p.tilt.ovCount ? `, soportes en ${p.tilt.ovCount} voladizos` : '') + '.')),
    el('p', { class: 'small' }, `${state.layout.plates.length} placa(s): míralas en la vista "Placas".`)));

  const fl = D.filament || {};
  info.append(fold('mech', 'Mecánica y sellado',
    kv([
      ['Robustez', { XS: 'XS — ultrapequeña', S: 'S — pequeña', M: 'M — mediana', L: 'L — grande' }[D.cls] || D.cls],
      ['Bisagras', `${D.hinge.n} × ${D.hinge.nk} nudillos (${D.hinge.len} mm)`],
      ['Cierres', `${D.latch.n} empotrados, ${D.latchW} mm`],
      ['Pasador bisagra', fl.hinge ? `filamento 1.75 · ${fl.hingeQty}× ${fl.hinge} mm` : `impreso Ø${D.pinD}`],
      ['Pasador cierre', fl.latch ? `filamento 1.75 · ${fl.latchQty}× ${fl.latch} mm` : `impreso Ø${D.latchPinD}`],
      ...(D.sealMode === 'tpu'
        ? [['Junta TPU', `${D.gkw} × ${D.gkh} mm · ${Math.round(D.c * 100)} % compresión`]]
        : [['Sellado', D.sealMode === 'labyrinth' ? 'laberinto doble' : 'lengüeta simple']]),
    ])));

  const hl = D.hullLine || [];
  info.append(fold('hull', 'Acabado (línea de contracción)',
    hl.length ? kv(hl.map((h) => [`${h.part} z=${h.z} mm`, `−${h.drop}% · ${h.masked}`, h.masked !== 'no'])) : el('p', { class: 'small' }, 'Sin transiciones bruscas.'),
    el('p', { class: 'small' }, (D.snapped.length ? 'Ajustes: ' + D.snapped.join(', ') + '. ' : '') + 'Recomendaciones de slicer en LEEME.txt.')));

  info.append(fold('parts', `Piezas (${parts.length})`,
    el('table', { class: 'parts' }, el('tbody', {}, parts.map((p) => el('tr', {},
      el('td', {}, el('span', { class: 'sw', style: `background:${COLORS[p.id]}` }), `${p.name} × ${p.instances.length}`,
        el('div', { class: 'small' }, p.material)),
      el('td', {}, `${(p.volume / 1000).toFixed(1)} cm³`)))))));

  // Registro de la construcción (también descargable para depurar).
  const logBtn = el('button', { class: 'ghost sm' }, 'Descargar registro');
  logBtn.addEventListener('click', () => download(JSON.stringify({
    fecha: new Date().toISOString(), version: '6', parametros: state.P,
    objetos: state.objects.map((x) => ({ nombre: x.name, cantidad: x.qty, w: x.raw.w, h: x.raw.h })),
    logo: state.svgName || null, avisos: D.warn, registro: D.log,
    piezas: parts.map((p) => ({ id: p.key, nombre: p.name, tri: p.tris, comp: p.components, vol: p.volume, estado: p.status, inclinada: p.tilt || null })),
  }, null, 2), `rugged-box-registro_${Date.now()}.json`, 'application/json'));
  info.append(fold('log', `Registro (${(D.log || []).length})`,
    el('pre', { class: 'log' }, (D.log || []).join('\n')), el('div', { style: 'text-align:right' }, logBtn)));
}

/* ------------------------------------------------------------------ */
/*  Calibración de holguras (perfil persistente + test adaptativo)    */
/* ------------------------------------------------------------------ */
const SRC_TXT = { test: 'medido', derived: 'deducido', manual: 'manual' };
const CAL_NAMES = {
  filClr: 'filamento en bisagra', clearance: 'pasador impreso Ø3', clearanceL: 'pasador impreso Ø5', tiltAdd: 'agujeros si va inclinada',
  latchPre: 'precarga del cierre', holeComp: 'agujeros verticales', sealClr: 'lengüeta',
  axialGap: 'entre nudillos', stackClr: 'apilado', insertTol: 'inserto en la caja', pocketTol: 'objeto en su hueco',
};
const fmt = (v) => `${Number(v).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} mm`;

function calTag(k) {
  const src = activeProfile(state.calib).src[k];
  return el('span', { class: 'caltag ' + (src || 'def'), 'data-calk': k, title: 'Valor del perfil de calibración' }, SRC_TXT[src] || 'por defecto');
}
function refreshCalTags() {
  const p = activeProfile(state.calib);
  for (const t of document.querySelectorAll('[data-calk]')) {
    const src = p.src[t.dataset.calk];
    t.className = 'caltag ' + (src || 'def');
    t.textContent = SRC_TXT[src] || 'por defecto';
  }
}

/** Holguras que usa la caja ACTUAL y que el perfil aún no ha medido. */
function unmeasured() {
  const p = activeProfile(state.calib);
  const keys = new Set(calibPlan(state.P, { mode: 'box' }).tests.map((t) => t.key));
  keys.add('axialGap');
  // El pasador impreso de esta caja depende de Ø3 y/o Ø5 (interpolado).
  if (keys.has('clearance')) { const D = derive(state.P); const d = Math.max(D.pinD, D.latchPinD); if (d > 3.01) keys.add('clearanceL'); if (Math.min(D.pinD, D.latchPinD) >= 5) keys.delete('clearance'); }
  return [...keys].filter((k) => p.src[k] !== 'test' && p.src[k] !== 'derived');
}

function calibControl() {
  const st = state.calib, p = activeProfile(st);
  const box = el('div', { class: 'calib' });

  // --- Perfil (impresora + material) ---
  const sel = el('select', { 'aria-label': 'Perfil de calibración' },
    Object.entries(st.profiles).map(([id, q]) => el('option', { value: id, ...(id === st.active ? { selected: '' } : {}) }, q.name)));
  sel.addEventListener('change', () => { st.active = sel.value; saveProfiles(st); applyProfile(); state.calibMsg = null; buildParams(); schedule(); });
  const bNew = el('button', { class: 'ghost sm', title: 'Nuevo perfil (copia del actual)', onclick: () => {
    const name = prompt('Nombre del perfil (impresora · material):', `${p.name} (copia)`);
    if (!name) return;
    addProfile(st, name.trim(), p); applyProfile(); buildParams(); schedule();
  } }, 'Nuevo');
  const bRen = el('button', { class: 'ghost sm', onclick: () => {
    const name = prompt('Nuevo nombre del perfil:', p.name);
    if (!name) return;
    p.name = name.trim(); saveProfiles(st); buildParams();
  } }, 'Renombrar');
  const bDel = Object.keys(st.profiles).length > 1 ? el('button', { class: 'ghost sm', onclick: () => {
    if (!confirm(`¿Borrar el perfil "${p.name}"?`)) return;
    removeProfile(st, st.active); applyProfile(); buildParams(); schedule();
  } }, 'Borrar') : null;
  box.append(el('div', { class: 'row calrow' }, sel, bNew, bRen, bDel));

  const missing = unmeasured();
  box.append(el('div', { class: 'small' },
    p.calibrated ? `Calibrado con test el ${new Date(p.calibrated).toLocaleDateString('es')}. ` : 'Sin calibrar: valores típicos de PLA/PETG con boquilla de 0.4. ',
    missing.length ? el('span', { class: 'warnTxt' }, `Esta caja usa holguras sin medir: ${missing.map((k) => CAL_NAMES[k]).join(', ')}.`) : 'Esta caja solo usa holguras medidas.'));

  // --- Resultado de la última aplicación ---
  if (state.calibMsg) {
    const m = state.calibMsg;
    box.append(el('div', { class: 'card key calmsg' },
      el('strong', {}, m.changes.length ? 'Holguras actualizadas' : 'Sin cambios: los valores actuales ya eran los mejores'),
      m.changes.length ? el('ul', {}, m.changes.map((c) => el('li', {}, `${CAL_NAMES[c.k]}: ${fmt(c.from)} → ${fmt(c.to)} (${c.why})`))) : null,
      m.retest ? el('div', { class: 'warnTxt' }, 'Alguna probeta quedó fuera del rango: genera otro test (se centrará en los nuevos valores).') : null,
      el('button', { class: 'ghost sm', onclick: () => { state.calibMsg = null; buildParams(); } }, 'Cerrar')));
  }

  // --- Test ---
  if (!p.plan) {
    const fine = el('input', { type: 'checkbox', ...(p.calibrated ? { checked: '' } : {}) });
    const modeU = el('input', { type: 'radio', name: 'calmode', value: 'universal', checked: '' });
    const modeB = el('input', { type: 'radio', name: 'calmode', value: 'box' });
    const go = el('button', { class: 'sm primary', onclick: () => {
      const plan = calibPlan(state.P, { fine: fine.checked, mode: modeB.checked ? 'box' : 'universal' });
      plan.P = { ...state.P };
      p.plan = plan; p.choices = {}; saveProfiles(st);
      state.calibMsg = null;
      buildParams();
      showCalib();
    } }, 'Generar test de holguras');
    box.append(
      el('p', { class: 'small' }, 'Imprime probetas que reproducen cada unión de la caja en la MISMA orientación en que se imprime (agujeros horizontales, verticales e inclinados, paredes en XY, primera capa, puente del retén), con holguras numeradas. Marcas la que mejor funcionó y el perfil se ajusta solo.'),
      el('label', { class: 'chk' }, modeU, ' Universal: vale para todas las cajas, de XS a L (≈ 25 g, ≈ 1 h 15 min)'),
      el('label', { class: 'chk' }, modeB, ' Solo las uniones de esta caja (≈ 10–25 g)'),
      el('label', { class: 'chk' }, fine, ' Paso fino (0.025 mm) para afinar un perfil ya calibrado'),
      el('div', { class: 'row' }, go));
  } else {
    const plan = p.plan;
    const info = state.calibResult?.info;
    box.append(el('div', { class: 'small' },
      `Test del ${new Date(plan.created).toLocaleDateString('es')} · ${plan.summary} · paso ${plan.step} mm`,
      info ? ` · ≈ ${info.grams} g, ≈ ${info.minutes} min, ${info.size[0]}×${info.size[1]} mm` : ''));
    box.append(el('div', { class: 'row' },
      el('button', { class: 'sm', onclick: showCalib }, state.calibView ? 'Actualizar vista' : 'Ver en 3D'),
      el('button', { class: 'sm', onclick: downloadCalib }, 'Descargar test'),
      el('button', { class: 'ghost sm', onclick: () => { if (confirm('¿Descartar este test?')) { p.plan = null; p.choices = {}; saveProfiles(st); hideCalib(); buildParams(); } } }, 'Descartar')));
    box.append(el('div', { class: 'small' }, 'Impreso el test, marca en cada probeta el número que mejor funcionó:'));
    for (const t of plan.tests) {
      const name = 'cal_' + t.id;
      const opt = (val, txt, title) => el('label', { class: 'calopt', title },
        el('input', { type: 'radio', name, value: String(val), ...(String(p.choices[t.id]) === String(val) ? { checked: '' } : {}),
          onchange: () => { p.choices[t.id] = val; saveProfiles(st); } }), txt);
      box.append(el('div', { class: 'caltest' },
        el('div', { class: 'lbl' }, el('strong', {}, `${t.id} · ${t.label}`)),
        el('div', { class: 'hint' }, t.how),
        el('div', { class: 'calopts' },
          t.variants.map((v) => opt(v.n, String(v.n), v.d ? `Ø${v.d} mm (holgura ${v.value})` : v.w ? `ranura ${v.w} mm (holgura ${v.value} por lado)` : `${t.key === 'latchPre' ? 'precarga' : 'holgura'} ${v.value} mm`)),
          opt('tight', t.key === 'latchPre' ? 'ninguno cierra' : 'todas duras', t.key === 'latchPre' ? 'Ni el de menos precarga cierra bien' : 'Hasta la más holgada quedó dura'),
          opt('loose', t.key === 'latchPre' ? 'todos flojos' : 'todas flojas', t.key === 'latchPre' ? 'Hasta el de más precarga queda con juego' : 'Hasta la más justa quedó floja'))));
    }
    box.append(el('div', { class: 'row' }, el('button', { class: 'sm primary', onclick: () => {
      const res = applyResults(plan, p.choices, p.values);
      if (!Object.values(p.choices).some((c) => c != null && c !== '')) { alert('Marca al menos una probeta.'); return; }
      const choices = { ...p.choices };
      setFromTest(st, res, plan, choices);
      applyProfile();
      state.calibMsg = res;
      hideCalib();
      buildParams();
      schedule();
    } }, 'Aplicar resultados')));
  }
  box.append(el('div', { class: 'row' }, el('button', { class: 'linkbtn', onclick: () => {
    if (!confirm('¿Volver a los valores por defecto en este perfil? Se pierde la calibración.')) return;
    resetProfile(st); applyProfile(); state.calibMsg = null; buildParams(); schedule();
  } }, 'Restablecer valores por defecto')));
  return box;
}

/** Construye las probetas y las muestra en el visor (con barra para volver). */
async function showCalib() {
  const p = activeProfile(state.calib);
  if (!p.plan) return;
  setStatus('ok', 'Generando el test de holguras…');
  const msg = await engine.calibration(p.plan.P || state.P, p.plan);
  if (!msg.ok) { setStatus('err', 'Error en el test: ' + String(msg.error).split('\n')[0]); console.error(msg.error); return; }
  state.calibResult = msg.r;
  state.calibView = true;
  viewer.setData(msg.r, computeLayout(msg.r), bed(), null);
  viewer.fit();
  const bar = $('#calbar');
  bar.hidden = false;
  $('#calbarText').textContent = `Test de holguras · ≈ ${msg.r.info.grams} g · ≈ ${msg.r.info.minutes} min · ${msg.r.parts.length} piezas`;
  setStatus('ok', 'Test de holguras listo');
  if (ui.tab === 'impresion') buildParams();
}

function hideCalib() {
  if (!state.calibView) return;
  state.calibView = false;
  $('#calbar').hidden = true;
  if (state.result) { viewer.setData(state.result, state.layout, bed(), contentPolys()); viewer.fit(); }
}

/** ZIP con el STL del test (todas las probetas colocadas) y el LEEME con la tabla. */
async function downloadCalib() {
  const p = activeProfile(state.calib);
  if (!p.plan) return;
  const msg = await engine.calibration(p.plan.P || state.P, p.plan);
  if (!msg.ok) { alert('No se pudo generar el test: ' + msg.error); return; }
  const r = msg.r, B = bed();
  const meshes = r.parts.map((q) => {
    const xyz = transformVerts(q.mesh.vert, q.mesh.numProp, q.instances[0]);
    for (let i = 0; i < xyz.length; i += 3) { xyz[i] -= r.info.size[0] / 2; xyz[i + 1] -= r.info.size[1] / 2; }
    return { xyz, tri: q.mesh.tri };
  });
  const all = mergeMeshes(meshes);
  const lines = [
    'TEST DE HOLGURAS — Rugged Box', '',
    `Perfil: ${p.name}`, `Generado: ${new Date(p.plan.created).toLocaleString('es')}`, `Configuración: ${p.plan.summary}`,
    `Material ≈ ${r.info.grams} g · tiempo ≈ ${r.info.minutes} min · placa ${r.info.size[0]}×${r.info.size[1]} mm (cama ${B.x}×${B.y})`, '',
    'Imprímelo con el MISMO material, boquilla, altura de capa y ajustes con los que imprimirás la caja',
    '(2 perímetros, relleno 15 %). Sin soportes, sin balsa ni borde: cada pieza ya está orientada',
    'como su unión en la caja (el útil E va boca abajo, como la tapa). Deja que se enfríe antes de probar.', '',
    'Necesitas unos 30 cm de filamento 1.75 recto como calibre y pasador.', '',
  ];
  for (const t of p.plan.tests) {
    lines.push(`${t.id} · ${t.label}`, `   ${t.how}`);
    for (const v of t.variants) lines.push(`   ${v.n}: ${v.d ? `agujero Ø${v.d} mm · ` : v.w ? `ranura ${v.w} mm · ` : ''}${t.key === 'latchPre' ? 'precarga' : 'holgura'} ${v.value} mm${v.cap ? `, tapón Ø${v.cap}` : ''}`);
    lines.push('');
  }
  lines.push('Después, en Impresión → Calibración de holguras, marca el mejor número de cada probeta y pulsa "Aplicar resultados".');
  const files = [
    { name: 'test-holguras.stl', data: stlBinary(all.xyz, all.tri, 'test de holguras') },
    { name: 'LEEME.txt', data: lines.join('\r\n') },
  ];
  download(zipStore(files), `test-holguras_${p.name.replace(/[^\w.-]+/g, '_')}.zip`);
}

/* ------------------------------------------------------------------ */
/*  Exportación                                                       */
/* ------------------------------------------------------------------ */
async function finalBuild() {
  const { P, svg } = payload();
  const msg = await engine.final(P, svg);
  if (msg.superseded) throw new Error('Exportación reemplazada por otra');
  if (!msg.ok) throw new Error(msg.error);
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
const FILE = { insert: 'inserto_base', insertLid: 'inserto_tapa', orgPanel: 'tapa_interior',  base: 'base', lid: 'tapa', latch: 'cierre', gasket: 'junta_TPU', hingePin: 'pasador_bisagra', latchPin: 'pasador_cierre', cap: 'tapon_pasador' };

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
    '  - Tapa: la cara decorada va contra la cama.',
    `  - Sin soportes: en las piezas planas ningún puente supera ${D.maxBridge ?? 10} mm (desactiva los soportes del laminador).`, '',
    ...(D.eco ? ['MODO AHORRO DE MATERIAL:',
      `  - Cambios: ${D.ecoChanges.join(', ') || 'ya estaba en mínimos'}.`,
      ...ecoSlicer(D).map(([k, v]) => `  - ${k}: ${v}.`),
      '  - La mecánica (bisagras, cierres, junta, holguras) es la misma que sin ahorro.', ''] : []),
    'MONTAJE:',
    '  1. Coloca la junta TPU en la ranura de la base (si aplica).',
    '  2. Alinea los nudillos de la tapa entre los de la base e inserta el pasador por el lado de la cabeza hasta que los dientes salten.',
    '     Bisagras: la cabeza de cada pasador va hacia el extremo de la caja más cercano.',
    '  3. Coloca cada cierre entre sus orejetas e inserta su pasador.',
  ];
  const fl = D.filament || {};
  const sideTxt = (x, s) => (Math.abs(x) < 1e-6 ? (s < 0 ? 'por la izquierda' : 'por la derecha') : s * x < 0 ? 'desde el centro de la caja' : 'desde el extremo de la caja');
  if (!fl.latch && D.latch.headSide) lines.push(`     Cierres: mete cada pasador ${D.latch.xs.map((x, i) => sideTxt(x, D.latch.headSide[i])).filter((v, i, a) => a.indexOf(v) === i).join(' / ')} (ese lado del eje queda libre).`);
  if (fl.hinge) lines.push(`  * Bisagra: corta ${fl.hingeQty}× ${fl.hinge} mm de filamento 1.75 mm, mételo recto y fíjalo con un tapón en cada extremo.`);
  if (fl.latch) lines.push(`  * Cierres: corta ${fl.latchQty}× ${fl.latch} mm de filamento 1.75 mm, mételo recto por el eje y fíjalo con los tapones.`);
  if (fl.hinge || fl.latch) lines.push('    Tapones (Ø4, tipo pinza): acércalos al extremo del filamento por debajo y empújalos ~2 mm hasta que hagan tope en la orejeta; la ranura se abre y los sujeta.',
    `    Si el filamento entra demasiado justo en el cierre o en los tapones, sube "Compensación de agujeros" (ahora ${D.holeComp ?? 0.15} mm) y reimprime solo esas piezas.`);
  if (D.stack) lines.push('  * Apilable: el pie de la base entra en el marco de la tapa de abajo y sus ranuras abrazan los nervios.');
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
$('#calBack').addEventListener('click', hideCalib);
$('#calDl').addEventListener('click', downloadCalib);
$('#btnZip').addEventListener('click', exportZip);
$('#btnStl').addEventListener('click', exportSingles);
$('#btnReset').addEventListener('click', () => {
  if (!confirm('¿Restablecer todos los parámetros?')) return;
  state.P = { ...DEFAULTS };
  applyProfile();                     // la calibración de la impresora se conserva
  safeDel(STORE);
  history.replaceState(null, '', location.pathname);
  buildParams();
  schedule();
});

buildParams();
if (state.objects.length) runPack(true);
schedule();

// Acceso para depuración y pruebas automatizadas.
window.__rugged = { state, viewer, setParam, contentChanged, buildParams };
