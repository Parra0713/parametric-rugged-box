/**
 * main.js — Interfaz: pestañas de parámetros, contenido a medida (varios
 * objetos con acomodo automático), comunicación con el motor, panel de
 * resultados y exportación.
 */
import { DEFAULTS, SCHEMA, TABS, BED_PRESETS, VERSION, migrate, contentModes } from './engine/params.js';
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
/*  Respuesta sin interrumpir: notificaciones breves y hojas propias  */
/*  (guía de interfaz: nunca alert / confirm / prompt del navegador)  */
/* ------------------------------------------------------------------ */

/**
 * Notificación breve sobre el visor; se va sola. Con `action` ofrece un
 * botón (p. ej. "Deshacer"). Como mucho tres a la vez.
 */
function toast(text, { action, onAction, kind = 'info', ms } = {}) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstChild._close(true);
  const t = el('div', { class: 'toast ' + kind, role: kind === 'err' ? 'alert' : 'status' }, el('span', { class: 'msg' }, text));
  let timer = 0;
  t._close = (now) => {
    clearTimeout(timer);
    if (now) { t.remove(); return; }
    t.classList.add('out');
    timer = setTimeout(() => t.remove(), 200);
  };
  if (action) t.append(el('button', { class: 'sm plain', onclick: () => { t._close(true); onAction?.(); } }, action));
  box.append(t);
  timer = setTimeout(() => t._close(), ms ?? (action ? 7000 : kind === 'err' ? 6000 : 3500));
  return t;
}

/**
 * Hoja de confirmación o de texto (diálogo propio, accesible con teclado:
 * Esc cancela, Intro acepta). Devuelve una promesa: `true`/`false`, o el
 * texto escrito (null si se cancela) cuando lleva `input`.
 * Solo para lo que NO se puede deshacer; lo demás se hace y se ofrece
 * "Deshacer".
 */
function sheet({ title, message, confirm = 'Aceptar', cancel = 'Cancelar', destructive = false, input = null }) {
  return new Promise((resolve) => {
    const field = input !== null ? el('input', { type: 'text', value: input, 'aria-label': title }) : null;
    const bCancel = el('button', { type: 'button', value: 'cancel' }, cancel);
    const bOk = el('button', { type: 'submit', value: 'ok', class: destructive ? 'danger' : 'primary' }, confirm);
    const form = el('form', { method: 'dialog' }, el('h3', {}, title), message ? el('p', {}, message) : null, field,
      el('div', { class: 'btns' }, bCancel, bOk));
    const dlg = el('dialog', { class: 'sheet' }, form);
    bCancel.addEventListener('click', () => dlg.close('cancel'));
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      dlg.remove();
      resolve(field ? (ok && field.value.trim() ? field.value.trim() : null) : ok);
    });
    document.body.append(dlg);
    dlg.showModal();
    // Lo seguro por defecto: en una acción destructiva el foco va a "Cancelar".
    if (field) { field.focus(); field.select(); } else (destructive ? bCancel : bOk).focus();
  });
}

/* ------------------------------------------------------------------ */
/*  Deshacer / rehacer                                                */
/* ------------------------------------------------------------------ */
/*
 * Historial de los parámetros de la caja (no de la calibración, que es de
 * la impresora y tiene su propio perfil). Cada entrada es el JSON completo
 * de los parámetros (~3 kB); se guardan como mucho 100. Los cambios
 * seguidos del mismo control (arrastrar un deslizador) cuentan como uno.
 */
const hist = { undo: [], redo: [], key: null, t: 0 };
const HIST_MAX = 100;
function snapshot() {
  const o = { ...state.P };
  for (const k of CAL_KEYS) delete o[k];
  return JSON.stringify(o);
}
/** Llamar ANTES de cambiar `state.P`. */
function remember(key = null) {
  const now = performance.now();
  if (key && key === hist.key && now - hist.t < 1200) { hist.t = now; return; }
  const s = snapshot();
  if (hist.undo[hist.undo.length - 1] !== s) hist.undo.push(s);
  if (hist.undo.length > HIST_MAX) hist.undo.shift();
  hist.redo.length = 0;
  hist.key = key; hist.t = now;
  updateHist();
}
function restore(s) {
  const o = JSON.parse(s);
  const P = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (k in o) P[k] = o[k];
  state.P = P;
  applyProfile();
  hist.key = null;
  buildParams();
  runPack(true);
  schedule();
  persistSoon();
  updateHist();
}
function undo() {
  if (!hist.undo.length) return;
  hist.redo.push(snapshot());
  restore(hist.undo.pop());
}
function redo() {
  if (!hist.redo.length) return;
  hist.undo.push(snapshot());
  restore(hist.redo.pop());
}
function updateHist() {
  $('#btnUndo').disabled = !hist.undo.length;
  $('#btnRedo').disabled = !hist.redo.length;
}

/* ------------------------------------------------------------------ */
/*  Panel de ajustes: pestañas + grupos + ajustes avanzados           */
/* ------------------------------------------------------------------ */
const controls = {};

/** Pinta el tramo recorrido de un deslizador (variable CSS --p). */
function paintRange(r) {
  const min = Number(r.min || 0), max = Number(r.max || 100);
  r.style.setProperty('--p', `${max > min ? Math.min(100, Math.max(0, ((Number(r.value) - min) / (max - min)) * 100)) : 0}%`);
}
document.addEventListener('input', (e) => { if (e.target.type === 'range') paintRange(e.target); });

/** ¿Se muestra este ajuste (o grupo) con los parámetros actuales? */
const applies = (x) => !x.when || x.when(state.P);
const visibleItems = (g) => g.items.filter((it) => applies(it) && (ui.expert || !it.adv));
/** Huella de lo visible en la pestaña actual: si cambia, se repinta el panel. */
const visSig = () => SCHEMA.filter((g) => g.tab === ui.tab && applies(g)).map((g) => g.group + ':' + g.items.filter(applies).map((it) => it.k).join(',')).join('|');

function buildParams() {
  const root = $('#params');
  const scroll = root.scrollTop;
  for (const k of Object.keys(controls)) delete controls[k];
  root.innerHTML = '';
  // Pestañas (el flujo de trabajo, de izquierda a derecha) como control
  // segmentado + interruptor de ajustes avanzados.
  const bar = el('div', { class: 'seg', role: 'tablist', 'aria-label': 'Secciones' }, TABS.map(([id, label, title]) =>
    el('button', { class: ui.tab === id ? 'on' : '', role: 'tab', title, 'aria-selected': String(ui.tab === id), 'data-tab': id,
      onclick: () => { ui.tab = id; saveUi(); buildParams(); $(`#params [data-tab="${id}"]`)?.focus(); } }, label)));
  const expert = el('label', { class: 'expert' }, 'Ajustes avanzados',
    el('input', { type: 'checkbox', class: 'switch', role: 'switch', ...(ui.expert ? { checked: '' } : {}), onchange: (e) => { ui.expert = e.target.checked; saveUi(); buildParams(); $('#params .expert input')?.focus(); } }));
  const [, , subtitle] = TABS.find(([id]) => id === ui.tab) || TABS[0];
  root.append(el('div', { class: 'tabhead' }, bar, el('div', { class: 'tabsub' }, el('span', {}, subtitle), expert)));

  for (const g of SCHEMA.filter((x) => x.tab === ui.tab && applies(x))) {
    const body = el('div', { class: 'group-body' });
    if (g.content) body.append(contentControl());
    if (g.svg) body.append(svgControl());
    if (g.gridfinity) body.append(gridfinitySnap());
    if (g.calib) body.append(calibControl());
    const items = visibleItems(g);
    for (const it of items) body.append(control(it));
    // Ajustes avanzados que aplican ahora pero están ocultos: se dice cuántos.
    const hidden = g.items.filter((it) => applies(it) && it.adv).length - items.filter((it) => it.adv).length;
    if (hidden) body.append(el('button', { class: 'linkbtn', onclick: () => { ui.expert = true; saveUi(); buildParams(); } },
      `Mostrar ${hidden} ajuste${hidden > 1 ? 's' : ''} avanzado${hidden > 1 ? 's' : ''}`));
    if (!body.children.length) continue;
    const key = g.group;
    const open = ui.open[key] !== false;
    const det = el('details', { class: 'group', ...(open ? { open: '' } : {}) }, el('summary', {}, g.group), body);
    det.addEventListener('toggle', () => { ui.open[key] = det.open; saveUi(); });
    root.append(det);
  }
  root.scrollTop = scroll;
  lastVis = visSig();
}
let lastVis = '';

function control(it) {
  const v = state.P[it.k];
  const hint = it.hint ? el('div', { class: 'hint' }, it.hint) : null;
  if (it.type === 'range') {
    const range = el('input', { type: 'range', min: it.min, max: it.max, step: it.step, value: v, 'aria-label': it.label });
    const num = el('input', { type: 'number', min: it.min, max: it.max, step: it.step, value: v, inputmode: 'decimal', 'aria-label': `${it.label}${it.unit ? ` (${it.unit})` : ''}` });
    paintRange(range);
    const sync = (val, src) => {
      const x = Math.min(it.max * 4, Math.max(it.min, Number(val)));
      if (!Number.isFinite(x)) return;
      if (src !== range) { range.value = x; paintRange(range); }
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
      range.value = x; paintRange(range);
      if (state.P[it.k] !== x) setParam(it.k, x);
    });
    num.addEventListener('change', () => sync(num.value, num));
    controls[it.k] = { el: range, set: (x) => { range.value = x; num.value = x; paintRange(range); } };
    return el('div', { class: 'field' },
      el('div', { class: 'lbl' }, it.label, it.cal ? calTag(it.k) : null),
      el('span', { class: 'num' }, num, it.unit ? el('span', { class: 'unit', 'aria-hidden': 'true' }, it.unit) : null), range, hint);
  }
  if (it.type === 'select') {
    const sel = el('select', { 'aria-label': it.label }, it.options.map(([val, txt]) => el('option', { value: val, ...(String(val) === String(v) ? { selected: '' } : {}) }, txt)));
    sel.addEventListener('change', () => setParam(it.k, sel.value));
    controls[it.k] = { el: sel, set: (x) => { sel.value = x; } };
    return el('div', { class: 'field sel' }, el('div', { class: 'lbl' }, it.label), sel, hint);
  }
  const cb = el('input', { type: 'checkbox', class: 'switch', role: 'switch', ...(v ? { checked: '' } : {}) });
  cb.addEventListener('change', () => setParam(it.k, cb.checked));
  controls[it.k] = { el: cb, set: (x) => { cb.checked = !!x; } };
  return el('label', { class: 'field tog' }, el('span', { class: 'lbl' }, it.label), cb, hint);
}

/* ------------------------------------------------------------------ */
/*  Contenido: varios objetos (calcos SVG 1:1) con acomodo automático */
/* ------------------------------------------------------------------ */
function contentControl() {
  const file = el('input', { type: 'file', accept: '.svg,image/svg+xml', multiple: '', hidden: '' });
  const add = el('button', { class: 'sm' }, 'Añadir objetos (SVG)…');
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
    if (errs.length) toast(`No se ${errs.length > 1 ? 'pudieron' : 'pudo'} leer:\n${errs.join('\n')}\nUsa un SVG con formas cerradas a escala 1:1 en mm.`, { kind: 'err', ms: 9000 });
    // Con objetos, lo natural es un inserto con sus huecos: en la base si
    // está libre; si no, en la tapa.
    const cm = contentModes(state.P);
    if (state.objects.length && cm.base !== 'pockets' && cm.lid !== 'pockets') {
      const k = cm.base === 'off' ? 'insertMode' : cm.lid === 'off' ? 'lidMode' : null;
      if (k) { remember(); state.P[k] = 'pockets'; }
    }
    saveObjects();
    buildParams();
    contentChanged();
  });

  const list = el('div', { class: 'objlist' });
  if (!state.objects.length) {
    list.append(el('div', { class: 'empty' },
      el('b', {}, 'Todavía no hay objetos.'), ' Añade el calco de cada pieza (SVG a escala 1:1 en mm). ',
      'Se acomodan solos en el mínimo espacio y el inserto les deja su hueco, con huecos para los dedos.'));
  }
  state.objects.forEach((o, i) => {
    const thumb = el('div', { class: 'thumb' }, el('img', { alt: '', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(o.text) }));
    const qty = el('div', { class: 'qty' },
      el('span', { class: 'small' }, 'Cantidad'),
      el('button', { class: 'sm', 'aria-label': `Una unidad menos de ${o.name}`, ...(o.qty <= 1 ? { disabled: '' } : {}), onclick: () => { o.qty = Math.max(1, o.qty - 1); saveObjects(); buildParams(); contentChanged(); } }, '−'),
      el('span', { 'aria-live': 'polite' }, String(o.qty)),
      el('button', { class: 'sm', 'aria-label': `Una unidad más de ${o.name}`, onclick: () => { o.qty = Math.min(50, o.qty + 1); saveObjects(); buildParams(); contentChanged(); } }, '+'));
    // Quitar no pregunta: se hace y se ofrece deshacerlo.
    const del = el('button', { class: 'plain sm', title: `Quitar ${o.name}`, 'aria-label': `Quitar ${o.name}`, onclick: () => {
      state.objects.splice(i, 1); saveObjects(); buildParams(); contentChanged();
      toast(`Se quitó «${o.name}»`, { action: 'Deshacer', onAction: () => { state.objects.splice(Math.min(i, state.objects.length), 0, o); saveObjects(); buildParams(); contentChanged(); } });
    } }, 'Quitar');
    list.append(el('div', { class: 'obj' }, thumb,
      el('div', { class: 'objinfo' }, el('div', { class: 'name' }, o.name), el('div', { class: 'small' }, dims(o.raw.w.toFixed(1), o.raw.h.toFixed(1)))),
      qty, del));
  });
  const status = el('div', { class: 'small packinfo', id: 'packInfo' }, packText());
  const again = state.objects.length ? el('button', { class: 'sm', onclick: () => { contentChanged(true); } }, 'Reorganizar') : null;
  return el('div', { class: 'svgbox' }, el('div', { class: 'row' }, add, again, file), list, status);
}

function packText() {
  const k = state.packed;
  if (!state.objects.length) return '';
  if (!k) return 'No caben con estas medidas. Agranda la caja o elige «Ajustarlo al contenido».';
  const n = k.placed.length;
  return `${n} pieza${n > 1 ? 's' : ''} acomodada${n > 1 ? 's' : ''} en ${dims(Math.round(k.w), Math.round(k.h))}.`;
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
    spacing: P.objSpacing, pocketTol: P.pocketTol, fingerCount: Object.values(contentModes(P)).includes('pockets') ? P.fingerCount : '0',
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
    remember();
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
    } catch (e) { toast(`No se pudo leer «${f.name}»: ${e.message}`, { kind: 'err' }); }
    file.value = '';
  });
  clear.addEventListener('click', () => {
    const old = { raw: state.svgRaw, text: state.svgText, name: state.svgName };
    state.svgRaw = null; state.svgText = ''; state.svgName = '';
    safeDel(STORE_SVG); refresh(); schedule();
    toast('Se quitó el logo', { action: 'Deshacer', onAction: () => {
      state.svgRaw = old.raw; state.svgText = old.text; state.svgName = old.name;
      safeSet(STORE_SVG, JSON.stringify({ name: old.name, text: old.text }));
      if (ui.tab === 'tapa') buildParams();
      schedule();
    } });
  });
  refresh();
  return el('div', { class: 'svgbox' },
    el('div', { class: 'row' }, thumb, el('div', { style: 'min-width:0;flex:1' }, name), pick, clear, file),
    el('div', { class: 'small' }, 'Se graba (o va en relieve) en la tapa. Usa formas con relleno; los trazos se convierten con su grosor.'));
}

/* ------------------------------------------------------------------ */
/*  Parámetros                                                        */
/* ------------------------------------------------------------------ */
const PACK_KEYS = new Set(['bedPreset', 'bedX', 'bedY', 'objSpacing', 'pocketTol', 'fingerCount', 'fingerD', 'fingerPos', 'objRotateAllow', 'contentFit', 'insertMode', 'lidMode', 'objClearance', 'insertTol']);

function setParam(k, v) {
  // Historial: solo cambios reales de la caja (la calibración va en su perfil).
  if (state.P[k] !== v && !CAL_KEYS.includes(k)) remember(k);
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
  // Revelación progresiva: si este cambio enseña u oculta ajustes, se
  // repinta el panel y el foco vuelve al control que se estaba usando.
  if (visSig() !== lastVis) {
    buildParams();
    controls[k]?.el?.focus({ preventScroll: true });
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
    setStatus('err', 'No se pudo generar la caja: ' + msg.error.split('\n')[0]); console.error(msg.error);
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
  paintRange(sp);
  const uiMs = Math.round(performance.now() - t0);
  // Estado discreto: qué se ve y cuánto tardó; el detalle, al pasar el ratón.
  setStatus('ok', full ? `Al día (${((msg.r.ms + uiMs) / 1000).toFixed(1).replace('.', ',')} s)` : 'Vista rápida',
    `${full ? 'Modelo completo' : 'Vista rápida'}: ${msg.r.ms} ms de geometría + ${uiMs} ms de vista, ${tris.toLocaleString('es')} triángulos`);
  updateBusy();
}

/** Indicador: "Calculando…" si lo visible está desfasado; "Afinando…" si es la vista rápida. */
function updateBusy() {
  const busy = $('#busy');
  if (shown.rev < rev) { busy.textContent = 'Calculando…'; busy.hidden = false; busy.dataset.kind = 'calc'; }
  else if (!shown.full) { busy.textContent = 'Afinando el modelo…'; busy.hidden = false; busy.dataset.kind = 'draft'; }
  else busy.hidden = true;
}

/** Contorno del contenido para el visor (marco interno). */
function contentPolys() {
  const pay = contentPayload().contentObjects;
  return pay ? pay.flatMap((q) => q.polys) : null;
}

/** Aplica una opción del optimizador (solo cambia los parámetros implicados). */
function applyOption(a) {
  remember();
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

function setStatus(kind, text, detail = '') {
  const s = $('#status');
  s.className = 'status ' + kind;
  s.title = detail;
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
/** Cifras como se escriben en español: coma decimal, hasta 2 decimales. */
const fmtN = (v) => Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2, useGrouping: false });
const NB = '\u00a0';                       // espacio duro: la unidad no se separa de su cifra
const mm = (v) => `${fmtN(v)}${NB}mm`;
/** «a × b × c mm» sin saltos de línea por dentro. */
const dims = (...v) => `${v.map(fmtN).join(`${NB}×${NB}`)}${NB}mm`;

function kv(rows) {
  // Una fila por dato (cada una reparte su ancho: una etiqueta larga no
  // estrecha los valores de las demás).
  return el('dl', { class: 'kv' }, rows.map(([k, v, hl]) => el('div', {}, el('dt', {}, k), el('dd', { class: hl ? 'hl' : '' }, v))));
}

/** Tarjeta plegable con estado recordado. */
function fold(id, title, ...body) {
  const open = ui.open['info:' + id] === true;
  const d = el('details', { class: 'fold', ...(open ? { open: '' } : {}) }, el('summary', {}, title), ...body);
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

  /* --- Resumen: lo primero que se lee es el espacio útil --- */
  const big = parts.filter((p) => ['base', 'lid', 'insert', 'insertLid'].includes(p.id));
  const tilted = parts.filter((p) => p.tilt);
  const diag = big.some((p) => !p.tilt && state.layout.fits[p.key]?.mode === 'diagonal');
  const printChip = tilted.length ? ['warn', 'Se imprime inclinada'] : diag ? ['ok', 'Cabe en diagonal'] : ['ok', 'Cabe plana'];
  const vol = parts.reduce((s, p) => s + p.volume * p.instances.length, 0);
  const nPl = state.layout.plates.length;
  // Qué lleva cada mitad (en palabras del usuario, no del motor).
  const halfText = (side) => {
    const mode = D.content[side], O = side === 'base' ? D.orgB : D.org, ins = side === 'base' ? D.insert : D.insertLid;
    if (mode === 'org' && O) return `${O.cols * O.rows} compartimentos de ${dims(O.cellL, O.cellW, O.depth)}`;
    if (mode === 'pockets') return ins && ins.pockets ? `inserto con ${ins.pockets} hueco${ins.pockets > 1 ? 's' : ''}` : 'inserto (faltan los objetos)';
    if (mode === 'blank') return 'inserto en blanco';
    return null;
  };
  const coverText = (O) => ({ single: 'una para todos', row: `una por fila (${O.panels.length})`, cell: `una por compartimento (${O.panels.length})` }[O.cover]);
  const covers = [['base', D.orgB], ['tapa', D.org]].filter(([, O]) => O && O.has);
  info.append(el('section', {},
    el('div', { class: 'headline' }, dims(I.L, I.W)),
    el('div', { class: 'small' }, `de espacio útil, con ${mm(I.baseDepth)} de fondo en la base y ${mm(I.lidDepth)} en la tapa`),
    el('div', { class: 'chips' },
      el('span', { class: 'chip ' + printChip[0] }, printChip[1]),
      el('span', { class: 'chip' }, `${nPl} placa${nPl > 1 ? 's' : ''}`),
      unmeasured().length
        ? el('button', { class: 'chip warn', title: 'Abrir la calibración de holguras', onclick: () => { ui.tab = 'impresion'; saveUi(); buildParams(); } }, 'Holguras sin medir')
        : el('span', { class: 'chip ok', title: activeProfile(state.calib).name }, 'Holguras medidas')),
    kv([
      ['Por fuera', dims(D.outerL, D.outerW, D.outerH)],
      ['Material', `unos ${Math.round(vol / 1000 * 1.24)}${NB}g de PLA`],
      ...(halfText('base') ? [['En la base', halfText('base')]] : []),
      ...(halfText('lid') ? [['En la tapa', halfText('lid')]] : []),
      ...covers.map(([n, O]) => [`Tapas interiores (${n})`, coverText(O)]),
    ])));

  /* --- Avisos y sugerencias: junto al resultado, sin interrumpir --- */
  const notes = el('section', { class: 'plainwrap' });
  if (D.warn.length) {
    notes.append(el('div', { class: 'callout warn' }, el('h3', {}, D.warn.length > 1 ? `${D.warn.length} avisos` : 'Aviso'),
      el('ul', {}, D.warn.map((w) => el('li', {}, w)))));
  }
  // Lo que hay que tener además de lo impreso (imanes, cordón, filamento).
  const extra = [];
  const fl0 = D.filament || {};
  const mags = [D.org, D.orgB].filter((O) => O && O.latch === 'magnet');
  if (mags.length) {
    const n = 2 * mags.reduce((s, O) => s + O.magnets.length, 0);
    extra.push(`${n} imanes de disco de ${dims(mags[0].magnet.d, mags[0].magnet.h)} (dos por punto de cierre)`);
    // Sugerencia de cantidad (estimación): fuerza de una pareja frente a la
    // carga de una tapa interior con las celdas medio llenas de tornillería.
    const mi = mags.map((O) => O.magnetInfo).sort((u, v) => v.suggested - u.suggested)[0];
    const put = Math.min(...mags.flatMap((O) => O.magnetInfo.placed));
    extra.push(`Imanes por tapa interior: ${mi.asked ? `${put} (elegidos por ti)` : `${put} (automático)`}. Sugeridos: ${mi.suggested}, porque cada pareja sujeta unos ${mi.pull}${NB}g y una tapa cargada pide unos ${mi.load}${NB}g (estimación)${mi.asked && put < mi.suggested ? '. Con menos de los sugeridos puede abrirse sola con la caja llena' : ''}`);
  }
  if (D.cord) extra.push(`${mm(D.cord.length)} de filamento TPU de 1,75${NB}mm para la junta`);
  if (fl0.hinge) extra.push(`${fl0.hingeQty} trozo${fl0.hingeQty > 1 ? 's' : ''} de ${mm(fl0.hinge)} de filamento de 1,75${NB}mm para las bisagras`);
  if (fl0.latch) extra.push(`${fl0.latchQty} trozo${fl0.latchQty > 1 ? 's' : ''} de ${mm(fl0.latch)} de filamento de 1,75${NB}mm para los cierres`);
  if (extra.length) notes.append(el('div', { class: 'callout' }, el('h3', {}, 'Además de lo impreso'), el('ul', {}, extra.map((x) => el('li', {}, x)))));

  /* --- Modo ahorro --- */
  if (D.eco) {
    const g = grams(parts);
    const ref = state.ecoRef && state.ecoRef.sig === ecoSig() ? state.ecoRef.g : null;
    notes.append(el('div', { class: 'callout ok' }, el('h3', {}, ref ? `Ahorro de material: ${ref - g} g menos (−${Math.round(100 * (1 - g / ref))} %)` : 'Ahorro de material activo'),
      kv([
        ...(ref ? [['Peso', `${ref} g → ${g} g`, true]] : []),
        ['Cambios', D.ecoChanges.length ? D.ecoChanges.join(', ') : 'ya estaba en mínimos'],
        ...(D.ecoStiff != null ? [['Rigidez de la pared', `${Math.round(100 * D.ecoStiff)} % de la caja normal${D.ecoStiff < 0.6 ? ' (el diseño «Nervado rígido» la recupera con menos material)' : ''}`, D.ecoStiff >= 0.95]] : []),
        ...ecoSlicer(D),
      ]),
      el('p', { class: 'small', style: 'margin-top:6px' }, 'Bisagras, cierres, junta y holguras no cambian: cierra y sella igual.')));
  }

  /* --- Acciones sugeridas: imprimir plana --- */
  const o = state.opt;
  if (o && o.status === 'option') {
    const box = el('div', { class: 'callout' }, el('h3', {}, 'Puede imprimirse plana'),
      el('p', { class: 'small' }, 'Con uno de estos cambios cabe sin inclinar ni soportes:'));
    o.alts.forEach((a, i) => {
      const btn = el('button', { class: i ? 'sm' : 'sm primary' }, 'Aplicar');
      btn.addEventListener('click', () => { applyOption(a); toast('Cambio aplicado', { action: 'Deshacer', onAction: undo }); });
      box.append(el('div', { class: 'opt' },
        el('div', { style: 'flex:1' }, a.changes.join(' + '),
          el('div', { class: 'small' }, a.fit.mode === 'diagonal' ? `Cabe en diagonal (${Math.round(a.fit.angle)}°)` : `Cabe ${a.fit.mode}`)), btn));
    });
    notes.append(box);
  }
  if (notes.children.length) info.append(notes);

  /* --- Contenido --- */
  if (state.objects.length) {
    const k = state.packed;
    const n = state.objects.reduce((s, x) => s + x.qty, 0);
    const where = ['base', 'lid'].filter((s) => D.content[s] === 'pockets').map((s) => (s === 'base' ? 'la base' : 'la tapa'));
    const nNotch = (D.insert?.notches.length ?? 0) + (D.insertLid?.notches.length ?? 0);
    info.append(el('section', {}, el('h3', {}, 'Contenido'),
      kv([
        ['Objetos', `${n} (${state.objects.length} tipo${state.objects.length > 1 ? 's' : ''})`],
        ['Acomodo', k ? dims(Math.round(k.w), Math.round(k.h)) : 'no caben con estas medidas', !!k],
        ['Huecos', where.length ? `en ${where.join(' y ')}${nNotch ? `, ${nNotch} para los dedos` : ''}` : 'ninguna mitad lleva inserto con huecos'],
        ...(state.cmax != null ? [['Recorte máximo de esquina', mm(state.cmax)]] : []),
      ])));
  }

  /* --- Detalles plegables --- */
  const copy = el('button', { class: 'sm' }, 'Copiar medidas (JSON)');
  copy.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(JSON.stringify(I, null, 2)); toast('Medidas copiadas'); }
    catch { toast('El navegador no dejó copiar. Las medidas van también en interior.json al exportar.', { kind: 'err' }); }
  });
  info.append(fold('inner', 'Medidas para diseñar insertos',
    kv([
      ['Largo × ancho', dims(I.L, I.W), true],
      ['Radio de esquina', mm(I.inner_corner_radius), true],
      ['Fondo de la base / de la tapa', `${fmtN(I.baseDepth)} / ${mm(I.lidDepth)}`],
      ['Alto total cerrada', mm(I.closedHeight), true],
      ['Chaflán del suelo / del techo', `${fmtN(I.floorChamfer)} / ${mm(I.lidChamfer)}`],
      ...(I.cornerCut ? [['Esquinas recortadas', mm(I.cornerCut)]] : []),
      ...(I.gridfinity ? [['Gridfinity', `${I.gridfinity.cells} celdas, bins de hasta ${I.gridfinity.units}U`, true]] : []),
    ]),
    el('p', { class: 'small', style: 'margin-top:8px' }, `Para un inserto propio: largo ≤ ${mm(I.L - 0.4)}, ancho ≤ ${mm(I.W - 0.4)}, radio ≥ ${mm(I.inner_corner_radius)} y chaflán inferior ≥ ${mm(I.floorChamfer)}.`),
    el('div', { class: 'right' }, copy)));

  const B = bed();
  info.append(fold('bed', `Impresión en cama de ${dims(B.x, B.y)}`,
    kv(parts.map((p) => [`${p.name}${p.instances.length > 1 ? ' ×' + p.instances.length : ''}`, orientShort(p) +
      ((state.layout.fits[p.key].aids || []).length ? ' + ayudas' : '')])),
    ...tilted.map((p) => el('p', { class: 'small' },
      `${p.name}: ${p.tilt.alpha}° sobre ${p.tilt.axis}, bisel ${p.tilt.cut} mm (franja ${p.tilt.contact} mm), ${p.tilt.finCount} aletas ` +
      `(${Math.round(100 * p.tilt.finVol / Math.max(1, p.tilt.wedgeVol))} % de una cuña)` + (p.tilt.ovCount ? `, soportes en ${p.tilt.ovCount} voladizos` : '') + '.')),
    el('p', { class: 'small', style: 'margin-top:8px' }, `${nPl} placa${nPl > 1 ? 's' : ''}: se ven en la vista «Placas».`)));

  const fl = D.filament || {};
  info.append(fold('mech', 'Mecánica y sellado',
    kv([
      ['Robustez', { XS: 'XS, ultrapequeña', S: 'S, pequeña', M: 'M, mediana', L: 'L, grande' }[D.cls] || D.cls],
      ['Bisagras', `${D.hinge.n} de ${D.hinge.nk} nudillos (${mm(D.hinge.len)})`],
      ['Cierres', `${D.latch.n} empotrados de ${mm(D.latchW)}`],
      ['Pasador de bisagra', fl.hinge ? `filamento de 1,75${NB}mm (${fl.hingeQty} de ${mm(fl.hinge)})` : `impreso, Ø${mm(D.pinD)}`],
      ['Pasador de cierre', fl.latch ? `filamento de 1,75${NB}mm (${fl.latchQty} de ${mm(fl.latch)})` : `impreso, Ø${mm(D.latchPinD)}`],
      ...(D.sealMode === 'tpu' ? [['Junta', `TPU impresa de ${dims(D.gkw, D.gkh)}, ${Math.round(D.c * 100)}${NB}% de compresión`]]
        : D.sealMode === 'cord' ? [['Junta', `cordón de filamento TPU Ø${mm(D.cordD)}, ${Math.round(D.c * 100)}${NB}% de compresión`], ['Ranura', `${dims(D.gw, D.gd)} (el cordón llena el ${Math.round(D.fill * 100)}${NB}%)`]]
          : [['Sellado', D.sealMode === 'labyrinth' ? 'laberinto doble' : 'lengüeta simple']]),
      ...covers.map(([n, O]) => [`Traba de las tapas interiores (${n})`, O.latch === 'magnet'
        ? `magnética, ${O.magnets.length} pareja${O.magnets.length > 1 ? 's' : ''} de imanes de ${dims(O.magnet.d, O.magnet.h)}` : 'mecánica (clic)']),
    ])));

  const hl = D.hullLine || [];
  info.append(fold('hull', 'Acabado (línea de contracción)',
    hl.length ? kv(hl.map((h) => [`${h.part}, a ${mm(h.z)}`, `−${h.drop}${NB}%, ${h.masked === 'no' ? 'sin disimular' : h.masked}`, h.masked !== 'no'])) : el('p', { class: 'small' }, 'Sin transiciones bruscas.'),
    el('p', { class: 'small', style: 'margin-top:8px' }, (D.snapped.length ? 'Ajustes: ' + D.snapped.join(', ') + '. ' : '') + 'Las recomendaciones para el laminador van en LEEME.txt.')));

  info.append(fold('parts', `Piezas (${parts.length})`,
    el('table', { class: 'parts' }, el('tbody', {}, parts.map((p) => el('tr', {},
      el('td', {}, el('span', { class: 'sw', style: `background:${COLORS[p.id]}` }), `${p.name}${p.instances.length > 1 ? ` × ${p.instances.length}` : ''}`,
        el('div', { class: 'small' }, p.material)),
      el('td', {}, `${fmtN((p.volume / 1000).toFixed(1))}${NB}cm³`)))))));

  // Registro de la construcción (también descargable para depurar).
  const logBtn = el('button', { class: 'sm' }, 'Descargar registro');
  logBtn.addEventListener('click', () => download(JSON.stringify({
    fecha: new Date().toISOString(), version: VERSION, parametros: state.P,
    objetos: state.objects.map((x) => ({ nombre: x.name, cantidad: x.qty, w: x.raw.w, h: x.raw.h })),
    logo: state.svgName || null, avisos: D.warn, registro: D.log,
    piezas: parts.map((p) => ({ id: p.key, nombre: p.name, tri: p.tris, comp: p.components, vol: p.volume, estado: p.status, inclinada: p.tilt || null })),
  }, null, 2), `rugged-box-registro_${Date.now()}.json`, 'application/json'));
  info.append(fold('log', 'Registro de la construcción',
    el('pre', { class: 'log' }, (D.log || []).join('\n')), el('div', { class: 'right', style: 'margin-top:8px' }, logBtn),
    el('p', { class: 'small' }, `Rugged Box ${VERSION}`)));
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
  const bNew = el('button', { class: 'sm', title: 'Crea un perfil nuevo a partir del actual', onclick: async () => {
    const name = await sheet({ title: 'Nuevo perfil', message: 'Un perfil por impresora y material. Empieza con los valores del perfil actual.', input: `${p.name} (copia)`, confirm: 'Crear' });
    if (!name) return;
    addProfile(st, name, p); applyProfile(); buildParams(); schedule();
  } }, 'Nuevo…');
  const bRen = el('button', { class: 'sm', onclick: async () => {
    const name = await sheet({ title: 'Renombrar el perfil', input: p.name, confirm: 'Renombrar' });
    if (!name) return;
    p.name = name; saveProfiles(st); buildParams();
  } }, 'Renombrar…');
  const bDel = Object.keys(st.profiles).length > 1 ? el('button', { class: 'sm danger', onclick: async () => {
    if (!await sheet({ title: `¿Borrar el perfil «${p.name}»?`, message: 'Se pierden sus holguras medidas. No se puede deshacer.', confirm: 'Borrar', destructive: true })) return;
    removeProfile(st, st.active); applyProfile(); buildParams(); schedule();
  } }, 'Borrar…') : null;
  box.append(el('div', { class: 'row calrow' }, sel, bNew, bRen, bDel));

  const missing = unmeasured();
  box.append(el('div', { class: 'small' },
    p.calibrated ? `Calibrado con test el ${new Date(p.calibrated).toLocaleDateString('es')}. ` : 'Sin calibrar: valores típicos de PLA/PETG con boquilla de 0.4. ',
    missing.length ? el('span', { class: 'warnTxt' }, `Esta caja usa holguras sin medir: ${missing.map((k) => CAL_NAMES[k]).join(', ')}.`) : 'Esta caja solo usa holguras medidas.'));

  // --- Resultado de la última aplicación ---
  if (state.calibMsg) {
    const m = state.calibMsg;
    box.append(el('div', { class: 'callout ok calmsg' },
      el('strong', {}, m.changes.length ? 'Holguras actualizadas' : 'Sin cambios: los valores actuales ya eran los mejores'),
      m.changes.length ? el('ul', {}, m.changes.map((c) => el('li', {}, `${CAL_NAMES[c.k]}: ${fmt(c.from)} → ${fmt(c.to)} (${c.why})`))) : null,
      m.retest ? el('div', { class: 'warnTxt' }, m.autoPlan
        ? `Fuera de rango: ${m.retestIds.join(', ')}. Ya está generado un test SOLO con ${m.retestIds.length > 1 ? 'esas probetas' : 'esa probeta'}, centrado en los nuevos valores: descárgalo abajo.`
        : 'Alguna probeta quedó fuera del rango: genera otro test (se centrará en los nuevos valores).') : null,
      el('div', { class: 'right' }, el('button', { class: 'sm', onclick: () => { state.calibMsg = null; buildParams(); } }, 'Entendido'))));
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
    // Esta caja usa holguras que el perfil no ha medido: test solo de esas.
    const goMissing = missing.length && p.calibrated ? el('button', { class: 'sm', onclick: () => {
      const plan = calibPlan(state.P, { fine: fine.checked, mode: 'box', onlyKeys: missing });
      if (!plan.tests.length) { toast('Esas holguras no tienen probeta propia: se deducen de las demás.'); return; }
      plan.P = { ...state.P };
      p.plan = plan; p.choices = {}; saveProfiles(st);
      state.calibMsg = null;
      buildParams();
      showCalib();
    } }, `Test solo de lo que falta (${missing.map((k) => CAL_NAMES[k]).join(', ')})`) : null;
    box.append(
      el('p', { class: 'small' }, 'Imprime probetas que reproducen cada unión de la caja en la MISMA orientación en que se imprime (agujeros horizontales, verticales e inclinados, paredes en XY, primera capa, puente del retén), con holguras numeradas. Marcas la que mejor funcionó y el perfil se ajusta solo.'),
      el('label', { class: 'chk' }, modeU, ' Universal: vale para todas las cajas, de XS a L (≈ 25 g, ≈ 1 h 15 min)'),
      el('label', { class: 'chk' }, modeB, ' Solo las uniones de esta caja (≈ 10–25 g)'),
      el('label', { class: 'chk' }, fine, ' Paso fino (0.025 mm) para afinar un perfil ya calibrado'),
      el('div', { class: 'row' }, go, goMissing));
  } else {
    const plan = p.plan;
    const info = state.calibResult?.info;
    box.append(el('div', { class: 'small' },
      `Test del ${new Date(plan.created).toLocaleDateString('es')} · ${plan.summary} · paso ${plan.step} mm`,
      info ? ` · ≈ ${info.grams} g, ≈ ${info.minutes} min, ${info.size[0]}×${info.size[1]} mm` : ''));
    box.append(el('div', { class: 'row' },
      el('button', { class: 'sm', onclick: showCalib }, state.calibView ? 'Actualizar vista' : 'Ver en 3D'),
      el('button', { class: 'sm', onclick: downloadCalib }, 'Descargar test'),
      el('button', { class: 'sm danger', onclick: async () => {
        if (!await sheet({ title: '¿Descartar este test?', message: 'Se pierden las probetas marcadas. Las holguras del perfil no cambian.', confirm: 'Descartar', destructive: true })) return;
        p.plan = null; p.choices = {}; saveProfiles(st); hideCalib(); buildParams();
      } }, 'Descartar…')));
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
      if (!Object.values(p.choices).some((c) => c != null && c !== '')) { toast('Marca primero el mejor número de al menos una probeta.'); return; }
      const res = applyResults(plan, p.choices, p.values);
      const choices = { ...p.choices };
      setFromTest(st, res, plan, choices);
      applyProfile();
      // Probetas fuera de rango: se genera solo de esas un test nuevo,
      // centrado en el valor ya desplazado (las demás no se reimprimen).
      if (res.retestIds && res.retestIds.length) {
        const again = calibPlan(state.P, { fine: plan.fine, mode: plan.mode, only: res.retestIds });
        if (again.tests.length) {
          again.P = { ...state.P };
          const q = activeProfile(st);
          q.plan = again; q.choices = {}; saveProfiles(st);
          res.autoPlan = true;
        }
      }
      state.calibMsg = res;
      hideCalib();
      buildParams();
      schedule();
    } }, 'Aplicar resultados')));
  }
  box.append(el('div', { class: 'row' }, el('button', { class: 'linkbtn', onclick: async () => {
    if (!await sheet({ title: '¿Restablecer las holguras de este perfil?', message: `«${p.name}» vuelve a los valores típicos y pierde lo medido con el test. No se puede deshacer.`, confirm: 'Restablecer', destructive: true })) return;
    resetProfile(st); applyProfile(); state.calibMsg = null; buildParams(); schedule();
  } }, 'Restablecer las holguras…')));
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
  if (!msg.ok) { toast('No se pudo generar el test: ' + String(msg.error).split('\n')[0], { kind: 'err' }); return; }
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

const fileName = (p) => FILE[p.id] + (p.id === 'orgPanel' && p.side === 'base' ? '_base' : '') + (p.key !== p.id ? '_' + (Number(p.key.replace(/\D/g, '')) + 1) : '');
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
    const zipName = `rugged-box_${I.L}x${I.W}x${I.closedHeight}.zip`;
    download(zipStore(files), zipName);
    toast(`Exportado: ${zipName} (${r.parts.length} piezas y LEEME)`);
  } catch (e) {
    toast('No se pudo exportar: ' + String(e.message).split('\n')[0], { kind: 'err' });
  } finally {
    btn.disabled = false; btn.textContent = 'Exportar todo';
  }
}

function orientText(f, p) {
  if (p.tilt) return `inclinada ${p.tilt.alpha}° sobre ${p.tilt.axis}; bisel de contacto de ${p.tilt.cut} mm (franja ${p.tilt.contact} mm); ${p.tilt.finCount} aletas de soporte (${(p.tilt.finVol / 1000).toFixed(1)} cm³, ${Math.round(100 * p.tilt.finVol / Math.max(1, p.tilt.wedgeVol))} % de una cuña maciza)`;
  if (!f.ok) return 'NO CABE en la cama';
  return f.mode + (f.mode === 'diagonal' ? ` ${f.angle}°` : '') + (f.aids?.length ? ' + ' + f.aids.join(', ') : '');
}

function readme(r, layout) {
  const D = r.D;
  const fl = D.filament || {};
  const orgs = [['tapa', D.org], ['base', D.orgB]].filter(([, O]) => O && O.has);
  const mags = orgs.filter(([, O]) => O.latch === 'magnet');
  // Lo que hay que tener además de lo impreso.
  const extra = [];
  if (mags.length) extra.push(`  - ${2 * mags.reduce((s, [, O]) => s + O.magnets.length, 0)} imanes de disco de ${mags[0][1].magnet.d} × ${mags[0][1].magnet.h} mm (neodimio; dos por punto de cierre de las tapas interiores).`);
  if (D.cord) extra.push(`  - ${D.cord.length} mm de filamento TPU de 1,75 mm (junta de cordón).`);
  if (fl.hinge) extra.push(`  - ${fl.hingeQty} × ${fl.hinge} mm de filamento rígido de 1,75 mm (pasadores de bisagra).`);
  if (fl.latch) extra.push(`  - ${fl.latchQty} × ${fl.latch} mm de filamento rígido de 1,75 mm (pasadores de cierre).`);
  const lines = [
    'RUGGED BOX — instrucciones de impresión y montaje',
    '='.repeat(50), '',
    `Generado con Rugged Box ${VERSION}`,
    `Interior: ${D.inner.L} × ${D.inner.W} mm, alto cerrado ${D.inner.closedHeight} mm, inner_corner_radius ${D.inner.inner_corner_radius} mm`,
    `Exterior: ${D.outerL} × ${D.outerW} × ${D.outerH} mm`, '',
    'PIEZAS (ya orientadas para imprimir, sin soportes):',
    ...r.parts.map((p) => `  - ${p.name} × ${p.instances.length}  [${p.material}]  → ${orientText(layout.fits[p.key], p)}`),
    '',
    ...(extra.length ? ['ADEMÁS DE LO IMPRESO:', ...extra, ''] : []),
    'AJUSTES RECOMENDADOS:',
    `  - Base/tapa: capa ${D.lh} mm, ancho de pared ${D.lw} mm (la pared mide ${D.t} mm = ${Math.round(D.t / D.lw)} líneas exactas), relleno gyroid 15–25 %.`,
    '  - Línea de contracción (además del diseño): perímetro exterior primero (outer/inner),',
    '    flujo de relleno sólido 95 %, tiempo mínimo de capa 6–8 s, ventilador constante,',
    '    "asegurar grosor de pared vertical" activado y sin "solo una pared en superficies superiores".',
    '  - Ayudas (*_ayudas.stl): orejas de 2 capas en esquinas, o aletas de soporte con dientes de 1 línea; se rompen a mano.',
    '    Las aletas van en planos perpendiculares al eje de inclinación: imprímelas en el mismo objeto que la pieza.',
    '  - Cierres: imprimir acostados (como vienen), 100 % de perímetros o 5+ paredes, PETG preferible (más elástico).',
    '  - Pasadores: acostados sobre la cara plana, 100 % de relleno.',
    ...(D.sealMode === 'tpu' ? ['  - Junta: TPU 95A, 0.2 mm, velocidad baja, 100 % de relleno.'] : []),
    ...(orgs.length ? ['  - Tapas interiores: con la cara exterior sobre la cama (como vienen), 3+ paredes.'] : []),
    '  - Tapa: la cara decorada va contra la cama.',
    `  - Sin soportes: en las piezas planas ningún puente supera ${D.maxBridge ?? 10} mm (desactiva los soportes del laminador).`, '',
    ...(D.eco ? ['MODO AHORRO DE MATERIAL:',
      `  - Cambios: ${D.ecoChanges.join(', ') || 'ya estaba en mínimos'}.`,
      ...ecoSlicer(D).map(([k, v]) => `  - ${k}: ${v}.`),
      '  - La mecánica (bisagras, cierres, junta, holguras) es la misma que sin ahorro.', ''] : []),
    'MONTAJE:',
    ...(D.sealMode === 'tpu' ? ['  1. Coloca la junta de TPU en la ranura de la base.']
      : D.cord ? [
        `  1. Junta de cordón: corta ${D.cord.length} mm de filamento TPU de 1,75 mm con un corte recto y mételo en la ranura de la base (${D.gw} mm de ancho).`,
        '     Empieza en el centro de un lado largo y deja las dos puntas a tope, sin montarlas; si sobra, recorta 1 mm cada vez.',
        `     La lengüeta de la tapa lo aprieta un ${Math.round(D.c * 100)} % al cerrar. Si el cierre queda muy duro, baja «Compresión de la junta».`]
        : ['  1. Esta caja no lleva junta: el sellado es la propia lengüeta.']),
    '  2. Alinea los nudillos de la tapa entre los de la base e inserta el pasador por el lado de la cabeza hasta que los dientes salten.',
    '     Bisagras: la cabeza de cada pasador va hacia el extremo de la caja más cercano.',
    '  3. Coloca cada cierre entre sus orejetas e inserta su pasador.',
  ];
  if (orgs.length) {
    lines.push(`  4. Tapas interiores (${orgs.map(([n]) => n).join(' y ')}): se montan abiertas a 90°, deslizándolas hacia el lado de su eje hasta que los dos pivotes salten a sus agujeros (clic).`,
      '     Para sacarlas, tira en sentido contrario. Se abren metiendo la yema del dedo en el pozo y enganchando el nervio que hay bajo la pestaña.',
      '     Traba de clic: al cerrar, el borde libre salta a una muesca de la pared (se nota el clic). Encajada no queda en tensión.',
      '     Si no caben planas en la cama, el archivo ya las trae inclinadas con sus aletas y soportes (como la base y la tapa).');
    if (mags.length) lines.push(
      `  5. Imanes (${mags[0][1].magnet.d} × ${mags[0][1].magnet.h} mm): van a presión, uno en cada pilar de la caja y otro en cada resalte de las tapas interiores, cara con cara.`,
      '     Mete primero los de la caja, apretando con algo plano hasta el fondo. ANTES de meter cada imán de una tapa interior comprueba la polaridad:',
      '     acércalo a su pareja ya puesta y márcalo por la cara que se atrae (esa cara es la que queda a la vista). Un imán al revés empuja la tapa en vez de cerrarla.',
      '     Si alguno queda flojo, una gota de cianoacrilato. No los metas en caliente ni los calientes: el neodimio pierde fuerza por encima de 80 °C.');
  }
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
  // Hoja propia: se crea al abrir y se elimina al cerrar (no deja nada en
  // memoria: las mallas de calidad final solo viven mientras está abierta).
  const dlg = document.body.appendChild(el('dialog', { class: 'sheet', 'aria-label': 'Descargar STL por pieza' }));
  dlg.addEventListener('close', () => dlg.remove());
  const close = () => el('div', { class: 'btns' }, el('button', { class: 'primary', onclick: () => dlg.close() }, 'Hecho'));
  dlg.append(el('h3', {}, 'STL por pieza'), el('p', {}, 'Generando las piezas con la calidad final…'));
  dlg.showModal();
  try {
    const r = await finalBuild();
    if (!dlg.isConnected) return;                 // se cerró mientras se generaba
    const layout = computeLayout(r);
    dlg.innerHTML = '';
    const list = el('div', { class: 'list' });
    for (const p of r.parts) {
      list.append(el('div', {},
        el('span', {}, `${p.name}${p.instances.length > 1 ? ` × ${p.instances.length}` : ''}`),
        el('button', { class: 'sm', 'aria-label': `Descargar ${p.name}`, onclick: () => {
          const m = printMesh(p, layout.fits[p.key].angle);
          const all = state.P.aidsInPart && m.aids.length ? mergeMeshes([{ xyz: m.xyz, tri: m.tri }, ...m.aids]) : m;
          download(stlBinary(all.xyz, all.tri, p.id), `${fileName(p)}.stl`, 'model/stl');
        } }, 'Descargar')));
    }
    dlg.append(el('h3', {}, 'STL por pieza'), el('p', {}, 'Cada pieza ya está orientada para imprimir.'), list, close());
  } catch (e) {
    dlg.innerHTML = '';
    dlg.append(el('h3', {}, 'No se pudieron generar las piezas'), el('p', {}, String(e.message).split('\n')[0]), close());
  }
}

/* ------------------------------------------------------------------ */
/*  Barra del visor                                                   */
/* ------------------------------------------------------------------ */
$('#modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  for (const x of $('#modeSeg').children) { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }
  viewer.setMode(b.dataset.mode);
  // "Abrir" solo tiene sentido con la caja montada: se muestra lo que aplica.
  $('#openWrap').hidden = b.dataset.mode !== 'assembled';
});
$('#open').addEventListener('input', (e) => viewer.setOpen(Number(e.target.value)));
$('#inner').addEventListener('change', (e) => viewer.setInterior(e.target.checked));
const section = () => {
  $('#sectionPos').hidden = !$('#section').checked;
  viewer.setSection($('#section').checked, Number($('#sectionPos').value));
};
$('#section').addEventListener('change', section);
$('#sectionPos').addEventListener('input', section);
$('#btnFit').addEventListener('click', () => viewer.fit());
$('#calBack').addEventListener('click', hideCalib);
$('#calDl').addEventListener('click', downloadCalib);
$('#btnZip').addEventListener('click', exportZip);
$('#btnStl').addEventListener('click', exportSingles);
// Restablecer no pregunta: se hace y se puede deshacer (historial).
$('#btnReset').addEventListener('click', () => {
  if (snapshot() === JSON.stringify(Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) => !CAL_KEYS.includes(k))))) { toast('La caja ya tiene los valores iniciales'); return; }
  remember();
  state.P = { ...DEFAULTS };
  applyProfile();                     // la calibración de la impresora se conserva
  safeDel(STORE);
  try { history.replaceState(null, '', location.pathname); } catch { /* límite del navegador */ }
  buildParams();
  runPack(true);
  schedule();
  toast('Caja restablecida a los valores iniciales', { action: 'Deshacer', onAction: undo });
});
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
// Ctrl/⌘+Z y Ctrl/⌘+Mayús+Z (o Ctrl+Y). En un campo de texto manda el
// deshacer del propio campo.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  const t = e.target;
  if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && ['text', 'number', 'search'].includes(t.type)))) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault();
  if (key === 'y' || e.shiftKey) redo(); else undo();
});
for (const r of document.querySelectorAll('.toolbar input[type=range]')) paintRange(r);
if (/Mac|iPhone|iPad/.test(navigator.platform || '')) { $('#btnUndo').title = 'Deshacer (⌘Z)'; $('#btnRedo').title = 'Rehacer (⇧⌘Z)'; }

buildParams();
if (state.objects.length) runPack(true);
schedule();

// Acceso para depuración y pruebas automatizadas.
// Asidero para las pruebas de interfaz (tests/ui.e2e.mjs): estado, visor e
// historial, y un recuento de lo que debe mantenerse estable (fugas).
window.__rugged = {
  state, viewer, setParam, contentChanged, buildParams, hist, undo, redo, toast,
  stats: () => ({
    geometries: viewer.renderer.info.memory.geometries,
    textures: viewer.renderer.info.memory.textures,
    nodes: document.getElementsByTagName('*').length,
    dialogs: document.querySelectorAll('dialog').length,
    toasts: document.querySelectorAll('.toast').length,
    undo: hist.undo.length,
  }),
};
