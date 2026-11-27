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
import { t, tm, isMsg, has, lang, langs, setLang, detectLang, onLang, fmtN, mm, dims, tabText, groupText, itemText, optionText } from './i18n/index.js';

/* ------------------------------------------------------------------ */
/*  Estado                                                            */
/* ------------------------------------------------------------------ */
const STORE = 'ruggedbox.params.v1';
const STORE_SVG = 'ruggedbox.svg.v1';
const STORE_OBJ = 'ruggedbox.content.v1';      // v4: un solo objeto (se migra)
const STORE_OBJS = 'ruggedbox.objects.v1';     // v6: lista de objetos
const STORE_UI = 'ruggedbox.ui.v1';

// Idioma: el elegido, el de la dirección (?lang=) o el del navegador.
setLang(detectLang(), { persist: false });

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
state.calib = loadProfiles(state.P, t('cal.defaultProfile'));
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
  const node = el('div', { class: 'toast ' + kind, role: kind === 'err' ? 'alert' : 'status' }, el('span', { class: 'msg' }, text));
  let timer = 0;
  node._close = (now) => {
    clearTimeout(timer);
    if (now) { node.remove(); return; }
    node.classList.add('out');
    timer = setTimeout(() => node.remove(), 200);
  };
  if (action) node.append(el('button', { class: 'sm plain', onclick: () => { node._close(true); onAction?.(); } }, action));
  box.append(node);
  timer = setTimeout(() => node._close(), ms ?? (action ? 7000 : kind === 'err' ? 6000 : 3500));
  return node;
}

/**
 * Hoja de confirmación o de texto (diálogo propio, accesible con teclado:
 * Esc cancela, Intro acepta). Devuelve una promesa: `true`/`false`, o el
 * texto escrito (null si se cancela) cuando lleva `input`.
 * Solo para lo que NO se puede deshacer; lo demás se hace y se ofrece
 * "Deshacer".
 */
function sheet({ title, message, confirm = t('ui.ok'), cancel = t('ui.cancel'), destructive = false, input = null }) {
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
  const bar = el('div', { class: 'seg', role: 'tablist', 'aria-label': t('ui.sections') }, TABS.map((tb) => { const id = tb[0]; return (
    el('button', { class: ui.tab === id ? 'on' : '', role: 'tab', title: tabText(tb, 'sub'), 'aria-selected': String(ui.tab === id), 'data-tab': id,
      onclick: () => { ui.tab = id; saveUi(); buildParams(); $(`#params [data-tab="${id}"]`)?.focus(); } }, tabText(tb))); }));
  const expert = el('label', { class: 'expert' }, t('ui.advanced'),
    el('input', { type: 'checkbox', class: 'switch', role: 'switch', ...(ui.expert ? { checked: '' } : {}), onchange: (e) => { ui.expert = e.target.checked; saveUi(); buildParams(); $('#params .expert input')?.focus(); } }));
  const subtitle = tabText(TABS.find(([id]) => id === ui.tab) || TABS[0], 'sub');
  root.append(el('div', { class: 'tabhead' }, bar, el('div', { class: 'tabsub' }, el('span', {}, subtitle), expert)));

  for (const g of SCHEMA.filter((x) => x.tab === ui.tab && applies(x))) {
    const body = el('div', { class: 'group-body' });
    if (g.content) body.append(contentControl());
    if (g.svg) body.append(svgControl());
    if (g.gridfinity) body.append(gridfinitySnap());
    if (g.calib) body.append(calibControl());
    const items = visibleItems(g);
    for (const it of items) body.append(control(g, it));
    // Ajustes avanzados que aplican ahora pero están ocultos: se dice cuántos.
    const hidden = g.items.filter((it) => applies(it) && it.adv).length - items.filter((it) => it.adv).length;
    if (hidden) body.append(el('button', { class: 'linkbtn', onclick: () => { ui.expert = true; saveUi(); buildParams(); } },
      t('ui.showAdvanced', { n: hidden })));
    if (!body.children.length) continue;
    const key = g.id;
    const open = ui.open[key] !== false;
    const det = el('details', { class: 'group', ...(open ? { open: '' } : {}) }, el('summary', {}, groupText(g)), body);
    det.addEventListener('toggle', () => { ui.open[key] = det.open; saveUi(); });
    root.append(det);
  }
  root.scrollTop = scroll;
  lastVis = visSig();
}
let lastVis = '';

function control(g, it) {
  const v = state.P[it.k];
  const label = itemText(g, it), hintTxt = itemText(g, it, 'hint');
  const hint = hintTxt ? el('div', { class: 'hint' }, hintTxt) : null;
  if (it.type === 'range') {
    const range = el('input', { type: 'range', min: it.min, max: it.max, step: it.step, value: v, 'aria-label': label });
    const num = el('input', { type: 'number', min: it.min, max: it.max, step: it.step, value: v, inputmode: 'decimal', 'aria-label': `${label}${it.unit ? ` (${it.unit})` : ''}` });
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
      el('div', { class: 'lbl' }, label, it.cal ? calTag(it.k) : null),
      el('span', { class: 'num' }, num, it.unit ? el('span', { class: 'unit', 'aria-hidden': 'true' }, it.unit) : null), range, hint);
  }
  if (it.type === 'select') {
    const sel = el('select', { 'aria-label': label }, it.options.map(([val, txt]) => el('option', { value: val, ...(String(val) === String(v) ? { selected: '' } : {}) }, optionText(g, it, val, txt))));
    sel.addEventListener('change', () => setParam(it.k, sel.value));
    controls[it.k] = { el: sel, set: (x) => { sel.value = x; } };
    return el('div', { class: 'field sel' }, el('div', { class: 'lbl' }, label), sel, hint);
  }
  const cb = el('input', { type: 'checkbox', class: 'switch', role: 'switch', ...(v ? { checked: '' } : {}) });
  cb.addEventListener('change', () => setParam(it.k, cb.checked));
  controls[it.k] = { el: cb, set: (x) => { cb.checked = !!x; } };
  return el('label', { class: 'field tog' }, el('span', { class: 'lbl' }, label), cb, hint);
}

/* ------------------------------------------------------------------ */
/*  Contenido: varios objetos (calcos SVG 1:1) con acomodo automático */
/* ------------------------------------------------------------------ */
function contentControl() {
  const file = el('input', { type: 'file', accept: '.svg,image/svg+xml', multiple: '', hidden: '' });
  const add = el('button', { class: 'sm' }, t('content.add'));
  add.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const errs = [];
    for (const f of file.files) {
      try {
        const text = await f.text();
        state.objects.push({ name: f.name.replace(/\.svg$/i, ''), text, qty: 1, raw: parseContentSVG(text) });
      } catch (e) { errs.push(`${f.name}: ${errText(e)}`); }
    }
    file.value = '';
    if (errs.length) toast(t('content.readError', { n: errs.length, list: errs.join('\n') }), { kind: 'err', ms: 9000 });
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
      el('b', {}, t('content.emptyTitle')), t('content.emptyBody')));
  }
  state.objects.forEach((o, i) => {
    const thumb = el('div', { class: 'thumb' }, el('img', { alt: '', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(o.text) }));
    const qty = el('div', { class: 'qty' },
      el('span', { class: 'small' }, t('content.qty')),
      el('button', { class: 'sm', 'aria-label': t('content.less', { name: o.name }), ...(o.qty <= 1 ? { disabled: '' } : {}), onclick: () => { o.qty = Math.max(1, o.qty - 1); saveObjects(); buildParams(); contentChanged(); } }, '−'),
      el('span', { 'aria-live': 'polite' }, String(o.qty)),
      el('button', { class: 'sm', 'aria-label': t('content.more', { name: o.name }), onclick: () => { o.qty = Math.min(50, o.qty + 1); saveObjects(); buildParams(); contentChanged(); } }, '+'));
    // Quitar no pregunta: se hace y se ofrece deshacerlo.
    const del = el('button', { class: 'plain sm', title: t('content.removeOne', { name: o.name }), 'aria-label': t('content.removeOne', { name: o.name }), onclick: () => {
      state.objects.splice(i, 1); saveObjects(); buildParams(); contentChanged();
      toast(t('content.removed', { name: o.name }), { action: t('ui.undo'), onAction: () => { state.objects.splice(Math.min(i, state.objects.length), 0, o); saveObjects(); buildParams(); contentChanged(); } });
    } }, t('ui.remove'));
    list.append(el('div', { class: 'obj' }, thumb,
      el('div', { class: 'objinfo' }, el('div', { class: 'name' }, o.name), el('div', { class: 'small' }, dims(o.raw.w.toFixed(1), o.raw.h.toFixed(1)))),
      qty, del));
  });
  const status = el('div', { class: 'small packinfo', id: 'packInfo' }, packText());
  const again = state.objects.length ? el('button', { class: 'sm', onclick: () => { contentChanged(true); } }, t('content.repack')) : null;
  return el('div', { class: 'svgbox' }, el('div', { class: 'row' }, add, again, file), list, status);
}

function packText() {
  const k = state.packed;
  if (!state.objects.length) return '';
  if (!k) return t('content.noFit');
  return t('content.packed', { n: k.placed.length, size: dims(Math.round(k.w), Math.round(k.h)) });
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
  const b = el('button', { class: 'sm' }, t('content.gridfinitySnap'));
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
  const name = el('div', { class: 'name' }, state.svgName || t('logo.none'));
  const clear = el('button', { class: 'ghost sm' }, t('ui.remove'));
  const pick = el('button', { class: 'sm' }, t('logo.pick'));
  const refresh = () => {
    name.textContent = state.svgName || t('logo.none');
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
    } catch (e) { toast(t('logo.readError', { name: f.name, error: errText(e) }), { kind: 'err' }); }
    file.value = '';
  });
  clear.addEventListener('click', () => {
    const old = { raw: state.svgRaw, text: state.svgText, name: state.svgName };
    state.svgRaw = null; state.svgText = ''; state.svgName = '';
    safeDel(STORE_SVG); refresh(); schedule();
    toast(t('logo.removed'), { action: t('ui.undo'), onAction: () => {
      state.svgRaw = old.raw; state.svgText = old.text; state.svgName = old.name;
      safeSet(STORE_SVG, JSON.stringify({ name: old.name, text: old.text }));
      if (ui.tab === 'tapa') buildParams();
      schedule();
    } });
  });
  refresh();
  return el('div', { class: 'svgbox' },
    el('div', { class: 'row' }, thumb, el('div', { style: 'min-width:0;flex:1' }, name), pick, clear, file),
    el('div', { class: 'small' }, t('logo.help')));
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
    setStatus('err', t('status.failed', { error: msg.error.split('\n')[0] })); console.error(msg.error);
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
  state.statusInfo = { full, ms: msg.r.ms, ui: uiMs, tris };
  showStatusInfo();
  updateBusy();
}

/** Indicador: "Calculando…" si lo visible está desfasado; "Afinando…" si es la vista rápida. */
function updateBusy() {
  const busy = $('#busy');
  if (shown.rev < rev) { busy.textContent = t('ui.computing'); busy.hidden = false; busy.dataset.kind = 'calc'; }
  else if (!shown.full) { busy.textContent = t('ui.refining'); busy.hidden = false; busy.dataset.kind = 'draft'; }
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

/** Estado del último modelo (se vuelve a escribir si cambia el idioma). */
function showStatusInfo() {
  const s = state.statusInfo;
  if (!s) return;
  setStatus('ok', s.full ? t('status.upToDate', { s: (s.ms + s.ui) / 1000 }) : t('status.draft'),
    t(s.full ? 'status.detailFull' : 'status.detailDraft', { ms: s.ms, ui: s.ui, tris: s.tris }));
}

/** Texto de un error: los de lectura de SVG llegan como clave. */
const errText = (e) => (has(e?.message) ? t(e.message) : String(e?.message ?? e));

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
// Cifras (fmtN, mm, dims) en el formato del idioma: src/i18n/index.js.
const NB = '\u00a0';                       // espacio duro: la unidad no se separa de su cifra
/** Nombre visible de una pieza. */
const pname = (p) => tm(p.label) || p.name;
/** Fecha corta en el idioma actual. */
const fdate = (d, time = false) => new Date(d)[time ? 'toLocaleString' : 'toLocaleDateString'](lang());

function kv(rows) {
  // Una fila por dato (cada una reparte su ancho: una etiqueta larga no
  // estrecha los valores de las demás).
  return el('dl', { class: 'kv' }, rows.map(([k, v, hl]) => el('div', {}, el('dt', {}, k), el('dd', { class: hl ? 'hl' : '' }, v))));
}

/** Tarjeta plegable con estado recordado. */
function fold(id, title, ...body) {
  const open = ui.open['info:' + id] === true;
  const d = el('details', { class: 'fold', 'data-fold': id, ...(open ? { open: '' } : {}) }, el('summary', {}, title), ...body);
  d.addEventListener('toggle', () => { ui.open['info:' + id] = d.open; saveUi(); });
  return d;
}

function orientShort(p) {
  const f = state.layout.fits[p.key];
  if (p.tilt) return t('orient.tilted', { a: p.tilt.alpha });
  return modeText(f);
}

/** Cómo va en la cama (los modos de bedfit.js son códigos internos). */
function modeText(f) {
  if (!f.ok) return t('orient.noFit');
  if (f.mode === 'diagonal') return t('orient.diagonal', { a: Math.round(f.angle) });
  return t(f.mode === 'recta' ? 'orient.flat' : 'orient.rotated');
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
    [t('info.eco.walls'), t('info.eco.wallsVal', { n: per, t: mm(D.t) })],
    [t('info.eco.shells'), t('info.eco.shellsVal', { n: shell })],
    [t('info.eco.infill'), t('info.eco.infillVal')],
    [t('info.eco.mech'), t('info.eco.mechVal')],
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
  const printChip = tilted.length ? ['warn', t('info.printsTilted')] : diag ? ['ok', t('info.fitsDiagonal')] : ['ok', t('info.fitsFlat')];
  const vol = parts.reduce((s, p) => s + p.volume * p.instances.length, 0);
  const nPl = state.layout.plates.length;
  // Qué lleva cada mitad (en palabras del usuario, no del motor).
  const halfText = (side) => {
    const mode = D.content[side], O = side === 'base' ? D.orgB : D.org, ins = side === 'base' ? D.insert : D.insertLid;
    if (mode === 'org' && O) return t('info.half.org', { n: O.cols * O.rows, size: dims(O.cellL, O.cellW, O.depth) });
    if (mode === 'pockets') return ins && ins.pockets ? t('info.half.pockets', { n: ins.pockets }) : t('info.half.pocketsEmpty');
    if (mode === 'blank') return t('info.half.blank');
    return null;
  };
  const coverText = (O) => t(`info.cover.${O.cover}`, { n: O.panels.length });
  const covers = [[t('sideShort.base'), D.orgB], [t('sideShort.lid'), D.org]].filter(([, O]) => O && O.has);
  info.append(el('section', {},
    el('div', { class: 'headline' }, dims(I.L, I.W)),
    el('div', { class: 'small' }, t('info.usable', { base: mm(I.baseDepth), lid: mm(I.lidDepth) })),
    el('div', { class: 'chips' },
      el('span', { class: 'chip ' + printChip[0] }, printChip[1]),
      el('span', { class: 'chip' }, t('info.plates', { n: nPl })),
      unmeasured().length
        ? el('button', { class: 'chip warn', title: t('info.calOpen'), onclick: () => { ui.tab = 'impresion'; saveUi(); buildParams(); } }, t('info.calMissing'))
        : el('span', { class: 'chip ok', title: activeProfile(state.calib).name }, t('info.calOk'))),
    kv([
      [t('info.outside'), dims(D.outerL, D.outerW, D.outerH)],
      [t('info.material'), t('info.grams', { g: Math.round(vol / 1000 * 1.24) })],
      ...(halfText('base') ? [[t('info.inBase'), halfText('base')]] : []),
      ...(halfText('lid') ? [[t('info.inLid'), halfText('lid')]] : []),
      ...covers.map(([n, O]) => [t('info.innerLids', { side: n }), coverText(O)]),
    ])));

  /* --- Avisos y sugerencias: junto al resultado, sin interrumpir --- */
  const notes = el('section', { class: 'plainwrap' });
  if (D.warn.length) {
    notes.append(el('div', { class: 'callout warn' }, el('h3', {}, t('info.warnTitle', { n: D.warn.length })),
      el('ul', {}, D.warn.map((w) => el('li', {}, tm(w))))));
  }
  // Lo que hay que tener además de lo impreso (imanes, cordón, filamento).
  const extra = [];
  const fl0 = D.filament || {};
  const mags = [D.org, D.orgB].filter((O) => O && O.latch === 'magnet');
  if (mags.length) {
    const n = 2 * mags.reduce((s, O) => s + O.magnets.length, 0);
    extra.push(t('info.extra.magnets', { n, size: dims(mags[0].magnet.d, mags[0].magnet.h) }));
    // Sugerencia de cantidad (estimación): fuerza de una pareja frente a la
    // carga de una tapa interior con las celdas medio llenas de tornillería.
    const mi = mags.map((O) => O.magnetInfo).sort((u, v) => v.suggested - u.suggested)[0];
    const put = Math.min(...mags.flatMap((O) => O.magnetInfo.placed));
    extra.push(t('info.extra.magnetPlan', { put, asked: !!mi.asked, suggested: mi.suggested, pull: mi.pull, load: mi.load, few: !!mi.asked && put < mi.suggested }));
  }
  if (D.cord) extra.push(t('info.extra.cord', { len: mm(D.cord.length) }));
  if (fl0.hinge) extra.push(t('info.extra.hinge', { n: fl0.hingeQty, len: mm(fl0.hinge) }));
  if (fl0.latch) extra.push(t('info.extra.latch', { n: fl0.latchQty, len: mm(fl0.latch) }));
  if (extra.length) notes.append(el('div', { class: 'callout' }, el('h3', {}, t('info.extraTitle')), el('ul', {}, extra.map((x) => el('li', {}, x)))));

  /* --- Modo ahorro --- */
  if (D.eco) {
    const g = grams(parts);
    const ref = state.ecoRef && state.ecoRef.sig === ecoSig() ? state.ecoRef.g : null;
    notes.append(el('div', { class: 'callout ok' }, el('h3', {}, ref ? t('info.eco.saved', { g: ref - g, pct: Math.round(100 * (1 - g / ref)) }) : t('info.eco.active')),
      kv([
        ...(ref ? [[t('info.eco.weight'), `${ref} g → ${g} g`, true]] : []),
        [t('info.eco.changes'), D.ecoChanges.length ? D.ecoChanges.map(tm).join(', ') : t('info.eco.none')],
        ...(D.ecoStiff != null ? [[t('info.eco.stiff'), t('info.eco.stiffVal', { pct: Math.round(100 * D.ecoStiff), low: D.ecoStiff < 0.6 }), D.ecoStiff >= 0.95]] : []),
        ...ecoSlicer(D),
      ]),
      el('p', { class: 'small', style: 'margin-top:6px' }, t('info.eco.note'))));
  }

  /* --- Acciones sugeridas: imprimir plana --- */
  const o = state.opt;
  if (o && o.status === 'option') {
    const box = el('div', { class: 'callout' }, el('h3', {}, t('info.flat.title')),
      el('p', { class: 'small' }, t('info.flat.body')));
    o.alts.forEach((a, i) => {
      const btn = el('button', { class: i ? 'sm' : 'sm primary' }, t('ui.apply'));
      btn.addEventListener('click', () => { applyOption(a); toast(t('info.flat.applied'), { action: t('ui.undo'), onAction: undo }); });
      box.append(el('div', { class: 'opt' },
        el('div', { style: 'flex:1' }, a.changes.map(tm).join(' + '),
          el('div', { class: 'small' }, a.fit.mode === 'diagonal' ? t('info.flat.diagonal', { a: Math.round(a.fit.angle) }) : t('info.flat.fits'))), btn));
    });
    notes.append(box);
  }
  if (notes.children.length) info.append(notes);

  /* --- Contenido --- */
  if (state.objects.length) {
    const k = state.packed;
    const n = state.objects.reduce((s, x) => s + x.qty, 0);
    const where = ['base', 'lid'].filter((s) => D.content[s] === 'pockets').map((s) => t(`side.${s}`));
    const nNotch = (D.insert?.notches.length ?? 0) + (D.insertLid?.notches.length ?? 0);
    info.append(el('section', {}, el('h3', {}, t('info.content')),
      kv([
        [t('info.objects'), t('info.objectsVal', { n, types: state.objects.length })],
        [t('info.packing'), k ? dims(Math.round(k.w), Math.round(k.h)) : t('info.noFit'), !!k],
        [t('info.pockets'), where.length ? t('info.pocketsVal', { where, notches: nNotch }) : t('info.pocketsNone')],
        ...(state.cmax != null ? [[t('info.maxCorner'), mm(state.cmax)]] : []),
      ])));
  }

  /* --- Detalles plegables --- */
  const copy = el('button', { class: 'sm' }, t('info.copyJson'));
  copy.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(JSON.stringify(I, null, 2)); toast(t('info.copied')); }
    catch { toast(t('info.copyFailed'), { kind: 'err' }); }
  });
  info.append(fold('inner', t('info.innerTitle'),
    kv([
      [t('info.lxw'), dims(I.L, I.W), true],
      [t('info.cornerR'), mm(I.inner_corner_radius), true],
      [t('info.depths'), `${fmtN(I.baseDepth)} / ${mm(I.lidDepth)}`],
      [t('info.closedH'), mm(I.closedHeight), true],
      [t('info.chamfers'), `${fmtN(I.floorChamfer)} / ${mm(I.lidChamfer)}`],
      ...(I.cornerCut ? [[t('info.cornerCut'), mm(I.cornerCut)]] : []),
      ...(I.gridfinity ? [['Gridfinity', t('info.gfVal', { cells: I.gridfinity.cells, u: I.gridfinity.units }), true]] : []),
    ]),
    el('p', { class: 'small', style: 'margin-top:8px' }, t('info.ownInsert', { l: mm(I.L - 0.4), w: mm(I.W - 0.4), r: mm(I.inner_corner_radius), c: mm(I.floorChamfer) })),
    el('div', { class: 'right' }, copy)));

  const B = bed();
  info.append(fold('bed', t('info.bedTitle', { size: dims(B.x, B.y) }),
    kv(parts.map((p) => [`${pname(p)}${p.instances.length > 1 ? ' ×' + p.instances.length : ''}`, orientShort(p) +
      ((state.layout.fits[p.key].aids || []).length ? t('info.withAids') : '')])),
    ...tilted.map((p) => el('p', { class: 'small' }, t('info.tiltDetail', {
      name: pname(p), a: p.tilt.alpha, axis: p.tilt.axis, cut: fmtN(p.tilt.cut), contact: fmtN(p.tilt.contact), fins: p.tilt.finCount,
      pct: Math.round(100 * p.tilt.finVol / Math.max(1, p.tilt.wedgeVol)), ov: p.tilt.ovCount || 0 }))),
    el('p', { class: 'small', style: 'margin-top:8px' }, t('info.platesHint', { n: nPl }))));

  const fl = D.filament || {};
  info.append(fold('mech', t('info.mechTitle'),
    kv([
      [t('info.size'), has(`info.size.${D.cls}`, 'es') ? t(`info.size.${D.cls}`) : D.cls],
      [t('info.hinges'), t('info.hingesVal', { n: D.hinge.n, k: D.hinge.nk, len: mm(D.hinge.len) })],
      [t('info.latches'), t('info.latchesVal', { n: D.latch.n, w: mm(D.latchW) })],
      [t('info.hingePin'), fl.hinge ? t('info.pinFil', { n: fl.hingeQty, len: mm(fl.hinge) }) : t('info.pinPrinted', { d: mm(D.pinD) })],
      [t('info.latchPin'), fl.latch ? t('info.pinFil', { n: fl.latchQty, len: mm(fl.latch) }) : t('info.pinPrinted', { d: mm(D.latchPinD) })],
      ...(D.sealMode === 'tpu' ? [[t('info.gasket'), t('info.gasketTpu', { size: dims(D.gkw, D.gkh), c: Math.round(D.c * 100) })]]
        : D.sealMode === 'cord' ? [[t('info.gasket'), t('info.gasketCord', { d: mm(D.cordD), c: Math.round(D.c * 100) })], [t('info.groove'), t('info.grooveVal', { size: dims(D.gw, D.gd), fill: Math.round(D.fill * 100) })]]
          : [[t('info.seal'), t(D.sealMode === 'labyrinth' ? 'info.seal.labyrinth' : 'info.seal.simple')]]),
      ...covers.map(([n, O]) => [t('info.innerLatch', { side: n }), O.latch === 'magnet'
        ? t('info.innerLatch.magnet', { n: O.magnets.length, size: dims(O.magnet.d, O.magnet.h) }) : t('info.innerLatch.snap')]),
    ])));

  const hl = D.hullLine || [];
  info.append(fold('hull', t('info.hullTitle'),
    hl.length ? kv(hl.map((h) => [t('info.hullAt', { part: t(`part.${h.part}`), z: mm(h.z) }), t('info.hullVal', { drop: h.drop, how: t(`info.hull.${h.masked}`) }), h.masked !== 'no'])) : el('p', { class: 'small' }, t('info.hullNone')),
    el('p', { class: 'small', style: 'margin-top:8px' }, (D.snapped.length ? t('info.snapped', { list: D.snapped.map(tm).join(', ') }) : '') + t('info.slicerNote'))));

  info.append(fold('parts', t('info.partsTitle', { n: parts.length }),
    el('table', { class: 'parts' }, el('tbody', {}, parts.map((p) => el('tr', {},
      el('td', {}, el('span', { class: 'sw', style: `background:${COLORS[p.id]}` }), `${pname(p)}${p.instances.length > 1 ? ` × ${p.instances.length}` : ''}`,
        el('div', { class: 'small' }, t(`mat.${p.id}`, null, p.material))),
      el('td', {}, `${fmtN((p.volume / 1000).toFixed(1))}${NB}cm³`)))))));

  // Registro de la construcción (también descargable para depurar).
  const logBtn = el('button', { class: 'sm' }, t('info.logDownload'));
  logBtn.addEventListener('click', () => download(JSON.stringify({
    fecha: new Date().toISOString(), version: VERSION, parametros: state.P,
    objetos: state.objects.map((x) => ({ nombre: x.name, cantidad: x.qty, w: x.raw.w, h: x.raw.h })),
    logo: state.svgName || null, avisos: D.warn.map(tm), registro: D.log,
    piezas: parts.map((p) => ({ id: p.key, nombre: p.name, tri: p.tris, comp: p.components, vol: p.volume, estado: p.status, inclinada: p.tilt || null })),
  }, null, 2), t('file.log', { t: Date.now() }), 'application/json'));
  info.append(fold('log', t('info.logTitle'),
    el('pre', { class: 'log' }, (D.log || []).join('\n')), el('div', { class: 'right', style: 'margin-top:8px' }, logBtn),
    el('p', { class: 'small' }, `Rugged Box ${VERSION}`)));
}

/* ------------------------------------------------------------------ */
/*  Calibración de holguras (perfil persistente + test adaptativo)    */
/* ------------------------------------------------------------------ */
const srcText = (src) => t(`cal.src.${['test', 'derived', 'manual'].includes(src) ? src : 'default'}`);
const calName = (k) => t(`cal.name.${k}`);
const fmt = (v) => `${fmtN(v, 3)} mm`;

function calTag(k) {
  const src = activeProfile(state.calib).src[k];
  return el('span', { class: 'caltag ' + (src || 'def'), 'data-calk': k, title: t('cal.tagTitle') }, srcText(src));
}
function refreshCalTags() {
  const p = activeProfile(state.calib);
  for (const tg of document.querySelectorAll('[data-calk]')) {
    const src = p.src[tg.dataset.calk];
    t.className = 'caltag ' + (src || 'def');
    t.textContent = srcText(src);
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
  const sel = el('select', { 'aria-label': t('cal.profile') },
    Object.entries(st.profiles).map(([id, q]) => el('option', { value: id, ...(id === st.active ? { selected: '' } : {}) }, q.name)));
  sel.addEventListener('change', () => { st.active = sel.value; saveProfiles(st); applyProfile(); state.calibMsg = null; buildParams(); schedule(); });
  const bNew = el('button', { class: 'sm', title: t('cal.newTitle'), onclick: async () => {
    const name = await sheet({ title: t('cal.newSheet'), message: t('cal.newSheetMsg'), input: t('cal.copyName', { name: p.name }), confirm: t('cal.create') });
    if (!name) return;
    addProfile(st, name, p); applyProfile(); buildParams(); schedule();
  } }, t('cal.new'));
  const bRen = el('button', { class: 'sm', onclick: async () => {
    const name = await sheet({ title: t('cal.renameSheet'), input: p.name, confirm: t('cal.renameOk') });
    if (!name) return;
    p.name = name; saveProfiles(st); buildParams();
  } }, t('cal.rename'));
  const bDel = Object.keys(st.profiles).length > 1 ? el('button', { class: 'sm danger', onclick: async () => {
    if (!await sheet({ title: t('cal.deleteSheet', { name: p.name }), message: t('cal.deleteMsg'), confirm: t('cal.deleteOk'), destructive: true })) return;
    removeProfile(st, st.active); applyProfile(); buildParams(); schedule();
  } }, t('cal.delete')) : null;
  box.append(el('div', { class: 'row calrow' }, sel, bNew, bRen, bDel));

  const missing = unmeasured();
  box.append(el('div', { class: 'small' },
    p.calibrated ? t('cal.calibrated', { date: fdate(p.calibrated) }) : t('cal.uncalibrated'),
    missing.length ? el('span', { class: 'warnTxt' }, t('cal.missing', { list: missing.map(calName).join(', ') })) : t('cal.allMeasured')));

  // --- Resultado de la última aplicación ---
  if (state.calibMsg) {
    const m = state.calibMsg;
    box.append(el('div', { class: 'callout ok calmsg' },
      el('strong', {}, m.changes.length ? t('cal.updated') : t('cal.noChange')),
      m.changes.length ? el('ul', {}, m.changes.map((c) => el('li', {}, t('cal.change', { name: calName(c.k), from: fmt(c.from), to: fmt(c.to), why: c.why })))) : null,
      m.retest ? el('div', { class: 'warnTxt' }, m.autoPlan
        ? t('cal.retestAuto', { ids: m.retestIds.join(', '), n: m.retestIds.length })
        : t('cal.retest')) : null,
      el('div', { class: 'right' }, el('button', { class: 'sm', onclick: () => { state.calibMsg = null; buildParams(); } }, t('ui.gotIt')))));
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
    } }, t('cal.generate'));
    // Esta caja usa holguras que el perfil no ha medido: test solo de esas.
    const goMissing = missing.length && p.calibrated ? el('button', { class: 'sm', onclick: () => {
      const plan = calibPlan(state.P, { fine: fine.checked, mode: 'box', onlyKeys: missing });
      if (!plan.tests.length) { toast(t('cal.noTestFor')); return; }
      plan.P = { ...state.P };
      p.plan = plan; p.choices = {}; saveProfiles(st);
      state.calibMsg = null;
      buildParams();
      showCalib();
    } }, t('cal.onlyMissing', { list: missing.map(calName).join(', ') })) : null;
    box.append(
      el('p', { class: 'small' }, t('cal.intro')),
      el('label', { class: 'chk' }, modeU, t('cal.modeUniversal')),
      el('label', { class: 'chk' }, modeB, t('cal.modeBox')),
      el('label', { class: 'chk' }, fine, t('cal.fine')),
      el('div', { class: 'row' }, go, goMissing));
  } else {
    const plan = p.plan;
    const info = state.calibResult?.info;
    box.append(el('div', { class: 'small' },
      t('cal.planLine', { date: fdate(plan.created), summary: plan.summary, step: fmtN(plan.step, 3) }),
      info ? t('cal.planInfo', { g: info.grams, min: info.minutes, w: info.size[0], h: info.size[1] }) : ''));
    box.append(el('div', { class: 'row' },
      el('button', { class: 'sm', onclick: showCalib }, state.calibView ? t('cal.refresh') : t('cal.view3d')),
      el('button', { class: 'sm', onclick: downloadCalib }, t('ui.calDownload')),
      el('button', { class: 'sm danger', onclick: async () => {
        if (!await sheet({ title: t('cal.discardSheet'), message: t('cal.discardMsg'), confirm: t('cal.discardOk'), destructive: true })) return;
        p.plan = null; p.choices = {}; saveProfiles(st); hideCalib(); buildParams();
      } }, t('cal.discard'))));
    box.append(el('div', { class: 'small' }, t('cal.markBest')));
    for (const ts of plan.tests) {
      const name = 'cal_' + ts.id;
      const pre = ts.key === 'latchPre';
      const opt = (val, txt, title) => el('label', { class: 'calopt', title },
        el('input', { type: 'radio', name, value: String(val), ...(String(p.choices[ts.id]) === String(val) ? { checked: '' } : {}),
          onchange: () => { p.choices[ts.id] = val; saveProfiles(st); } }), txt);
      box.append(el('div', { class: 'caltest' },
        el('div', { class: 'lbl' }, el('strong', {}, `${ts.id} · ${tm(ts.label)}`)),
        el('div', { class: 'hint' }, tm(ts.how)),
        el('div', { class: 'calopts' },
          ts.variants.map((v) => opt(v.n, String(v.n), v.d ? t('cal.varHole', { d: fmtN(v.d, 3), v: fmtN(v.value, 3) }) : v.w ? t('cal.varSlot', { w: fmtN(v.w, 3), v: fmtN(v.value, 3) }) : t(pre ? 'cal.varPre' : 'cal.varTol', { v: fmtN(v.value, 3) }))),
          opt('tight', t(pre ? 'cal.tightPre' : 'cal.tight'), t(pre ? 'cal.tightPreTitle' : 'cal.tightTitle')),
          opt('loose', t(pre ? 'cal.loosePre' : 'cal.loose'), t(pre ? 'cal.loosePreTitle' : 'cal.looseTitle')))));
    }
    box.append(el('div', { class: 'row' }, el('button', { class: 'sm primary', onclick: () => {
      if (!Object.values(p.choices).some((c) => c != null && c !== '')) { toast(t('cal.markFirst')); return; }
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
    } }, t('cal.applyResults'))));
  }
  box.append(el('div', { class: 'row' }, el('button', { class: 'linkbtn', onclick: async () => {
    if (!await sheet({ title: t('cal.resetSheet'), message: t('cal.resetMsg', { name: p.name }), confirm: t('cal.resetOk'), destructive: true })) return;
    resetProfile(st); applyProfile(); state.calibMsg = null; buildParams(); schedule();
  } }, t('cal.reset'))));
  return box;
}

/** Construye las probetas y las muestra en el visor (con barra para volver). */
async function showCalib() {
  const p = activeProfile(state.calib);
  if (!p.plan) return;
  setStatus('ok', t('status.calBuilding'));
  const msg = await engine.calibration(p.plan.P || state.P, p.plan);
  if (!msg.ok) { setStatus('err', t('status.calFailed', { error: String(msg.error).split('\n')[0] })); console.error(msg.error); return; }
  state.calibResult = msg.r;
  state.calibView = true;
  viewer.setData(msg.r, computeLayout(msg.r), bed(), null);
  viewer.fit();
  const bar = $('#calbar');
  bar.hidden = false;
  state.calBarInfo = { g: msg.r.info.grams, min: msg.r.info.minutes, n: msg.r.parts.length };
  $('#calbarText').textContent = t('status.calBar', state.calBarInfo);
  setStatus('ok', t('status.calReady'));
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
  if (!msg.ok) { toast(t('cal.buildFailed', { error: String(msg.error).split('\n')[0] }), { kind: 'err' }); return; }
  const r = msg.r, B = bed();
  const meshes = r.parts.map((q) => {
    const xyz = transformVerts(q.mesh.vert, q.mesh.numProp, q.instances[0]);
    for (let i = 0; i < xyz.length; i += 3) { xyz[i] -= r.info.size[0] / 2; xyz[i + 1] -= r.info.size[1] / 2; }
    return { xyz, tri: q.mesh.tri };
  });
  const all = mergeMeshes(meshes);
  const lines = [...t('cal.readme', {
    profile: p.name, date: fdate(p.plan.created, true), summary: tm(p.plan.summary),
    g: r.info.grams, min: r.info.minutes, w: r.info.size[0], h: r.info.size[1], bx: B.x, by: B.y,
  })];
  for (const ts of p.plan.tests) {
    lines.push(`${ts.id} · ${tm(ts.label)}`, `   ${tm(ts.how)}`);
    for (const v of ts.variants) lines.push(t('cal.readmeVar', { n: v.n, d: v.d, w: v.w, v: v.value, cap: v.cap, pre: ts.key === 'latchPre' }));
    lines.push('');
  }
  lines.push(t('cal.readmeEnd'));
  const files = [
    { name: t('file.calStl'), data: stlBinary(all.xyz, all.tri, 'tolerance test') },
    { name: t('file.readme'), data: lines.join('\r\n') },
  ];
  download(zipStore(files), t('file.calZip', { name: p.name.replace(/[^\w.-]+/g, '_') }));
}

/* ------------------------------------------------------------------ */
/*  Exportación                                                       */
/* ------------------------------------------------------------------ */
async function finalBuild() {
  const { P, svg } = payload();
  const msg = await engine.final(P, svg);
  if (msg.superseded) throw new Error(t('export.superseded'));
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

/** Nombre de archivo de una pieza, en el idioma de la interfaz. */
const fileName = (p) => t(`file.${p.id}`) + (p.id === 'orgPanel' && p.side === 'base' ? t('file.baseSuffix') : '') + (p.key !== p.id ? '_' + (Number(p.key.replace(/\D/g, '')) + 1) : '');

async function exportZip() {
  const btn = $('#btnZip');
  btn.disabled = true; btn.textContent = t('ui.exporting');
  try {
    const r = await finalBuild();
    const layout = computeLayout(r);
    const files = [];
    for (const p of r.parts) {
      const m = printMesh(p, layout.fits[p.key].angle);
      const dir = t('file.partsDir');
      files.push({ name: `${dir}/${fileName(p)}_x${p.instances.length}.stl`, data: stlBinary(m.xyz, m.tri, p.id) });
      if (m.aids.length) {
        if (state.P.aidsInPart) {
          // Pieza + ayudas en un único STL, ya colocadas para imprimir.
          const all = mergeMeshes([{ xyz: m.xyz, tri: m.tri }, ...m.aids]);
          files[files.length - 1] = { name: `${dir}/${fileName(p)}_x${p.instances.length}${t('file.withSupports')}.stl`, data: stlBinary(all.xyz, all.tri, p.id) };
        } else {
          const ag = mergeMeshes(m.aids);
          files.push({ name: `${dir}/${fileName(p)}${t('file.aids')}.stl`, data: stlBinary(ag.xyz, ag.tri, p.id + ' aids') });
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
      files.push({ name: `${t('file.platesDir')}/${t('file.plate', { n: k + 1 })}.stl`, data: stlBinary(mg.xyz, mg.tri, `plate ${k + 1}`) });
    });
    files.push({ name: t('file.readme'), data: readme(r, layout) });
    files.push({ name: t('file.params'), data: JSON.stringify(state.P, null, 2) });
    files.push({ name: t('file.inner'), data: JSON.stringify(r.D.inner, null, 2) });
    const I = r.D.inner;
    const zipName = `rugged-box_${I.L}x${I.W}x${I.closedHeight}.zip`;
    download(zipStore(files), zipName);
    toast(t('export.done', { zip: zipName, n: r.parts.length }));
  } catch (e) {
    toast(t('export.failed', { error: String(e.message).split('\n')[0] }), { kind: 'err' });
  } finally {
    btn.disabled = false; btn.textContent = t('ui.exportAll');
  }
}

function orientText(f, p) {
  if (p.tilt) return t('readme.orient.tilted', { a: p.tilt.alpha, axis: p.tilt.axis, cut: p.tilt.cut, contact: p.tilt.contact, fins: p.tilt.finCount,
    vol: (p.tilt.finVol / 1000).toFixed(1), pct: Math.round(100 * p.tilt.finVol / Math.max(1, p.tilt.wedgeVol)) });
  if (!f.ok) return t('readme.orient.noFit');
  return modeText(f) + ((p.aids || []).length ? ' + ' + p.aids.map((a) => tm(a.label) || a.name).join(', ') : '');
}

function readme(r, layout) {
  const D = r.D;
  const fl = D.filament || {};
  const orgs = [['lid', D.org], ['base', D.orgB]].filter(([, O]) => O && O.has);
  const mags = orgs.filter(([, O]) => O.latch === 'magnet');
  const L = (x) => (Array.isArray(x) ? x : [x]);            // una clave puede dar varias líneas
  // Lo que hay que tener además de lo impreso.
  const extra = [];
  if (mags.length) extra.push(t('readme.extra.magnets', { n: 2 * mags.reduce((s, [, O]) => s + O.magnets.length, 0), d: mags[0][1].magnet.d, h: mags[0][1].magnet.h }));
  if (D.cord) extra.push(t('readme.extra.cord', { len: D.cord.length }));
  if (fl.hinge) extra.push(t('readme.extra.hinge', { n: fl.hingeQty, len: fl.hinge }));
  if (fl.latch) extra.push(t('readme.extra.latch', { n: fl.latchQty, len: fl.latch }));
  const lines = [
    t('readme.title'),
    '='.repeat(50), '',
    t('readme.made', { v: VERSION }),
    t('readme.inner', { l: D.inner.L, w: D.inner.W, h: D.inner.closedHeight, r: D.inner.inner_corner_radius }),
    t('readme.outer', { l: D.outerL, w: D.outerW, h: D.outerH }), '',
    t('readme.parts'),
    ...r.parts.map((p) => `  - ${pname(p)} × ${p.instances.length}  [${t(`mat.${p.id}`, null, p.material)}]  → ${orientText(layout.fits[p.key], p)}`),
    '',
    ...(extra.length ? [t('readme.extra'), ...extra, ''] : []),
    t('readme.settings'),
    t('readme.s.body', { lh: D.lh, lw: D.lw, t: D.t, lines: Math.round(D.t / D.lw) }),
    ...L(t('readme.s.shrink')),
    ...L(t('readme.s.aids')),
    t('readme.s.latch'),
    t('readme.s.pins'),
    ...(D.sealMode === 'tpu' ? [t('readme.s.gasket')] : []),
    ...(orgs.length ? [t('readme.s.innerLids')] : []),
    t('readme.s.lid'),
    t('readme.s.noSupports', { mm: D.maxBridge ?? 10 }), '',
    ...(D.eco ? [t('readme.eco'),
      t('readme.eco.changes', { list: D.ecoChanges.map(tm).join(', ') || t('info.eco.none') }),
      ...ecoSlicer(D).map(([k, v]) => `  - ${k}: ${v}.`),
      t('readme.eco.mech'), ''] : []),
    t('readme.assembly'),
    ...(D.sealMode === 'tpu' ? [t('readme.a.tpu')]
      : D.cord ? L(t('readme.a.cord', { len: D.cord.length, gw: D.gw, c: Math.round(D.c * 100) }))
        : [t('readme.a.noGasket')]),
    ...L(t('readme.a.hinge')),
    t('readme.a.latch'),
  ];
  if (orgs.length) {
    lines.push(...L(t('readme.a.innerLids', { sides: orgs.map(([n]) => t(`sideShort.${n}`)) })));
    if (mags.length) lines.push(...L(t('readme.a.magnets', { d: mags[0][1].magnet.d, h: mags[0][1].magnet.h })));
  }
  const sideTxt = (x, s) => t(Math.abs(x) < 1e-6 ? (s < 0 ? 'readme.side.left' : 'readme.side.right') : s * x < 0 ? 'readme.side.center' : 'readme.side.end');
  if (!fl.latch && D.latch.headSide) lines.push(t('readme.a.latchSide', { sides: D.latch.xs.map((x, i) => sideTxt(x, D.latch.headSide[i])).filter((v, i, a) => a.indexOf(v) === i).join(' / ') }));
  if (fl.hinge) lines.push(t('readme.a.filHinge', { n: fl.hingeQty, len: fl.hinge }));
  if (fl.latch) lines.push(t('readme.a.filLatch', { n: fl.latchQty, len: fl.latch }));
  if (fl.hinge || fl.latch) lines.push(...L(t('readme.a.caps', { hc: D.holeComp ?? 0.15 })));
  if (D.stack) lines.push(t('readme.a.stack'));
  if (D.gfPlate) lines.push(t('readme.a.gf', { nx: D.inner.gridfinity.nx, ny: D.inner.gridfinity.ny, u: D.inner.gridfinity.units }));
  if (D.warn.length) lines.push('', t('readme.warnings'), ...D.warn.map((w) => '  ! ' + tm(w)));
  return lines.join('\r\n');
}

async function exportSingles() {
  // Hoja propia: se crea al abrir y se elimina al cerrar (no deja nada en
  // memoria: las mallas de calidad final solo viven mientras está abierta).
  const dlg = document.body.appendChild(el('dialog', { class: 'sheet', 'aria-label': t('stl.dialog') }));
  dlg.addEventListener('close', () => dlg.remove());
  const close = () => el('div', { class: 'btns' }, el('button', { class: 'primary', onclick: () => dlg.close() }, t('ui.done')));
  dlg.append(el('h3', {}, t('stl.title')), el('p', {}, t('stl.building')));
  dlg.showModal();
  try {
    const r = await finalBuild();
    if (!dlg.isConnected) return;                 // se cerró mientras se generaba
    const layout = computeLayout(r);
    dlg.innerHTML = '';
    const list = el('div', { class: 'list' });
    for (const p of r.parts) {
      list.append(el('div', {},
        el('span', {}, `${pname(p)}${p.instances.length > 1 ? ` × ${p.instances.length}` : ''}`),
        el('button', { class: 'sm', 'aria-label': t('stl.download', { name: pname(p) }), onclick: () => {
          const m = printMesh(p, layout.fits[p.key].angle);
          const all = state.P.aidsInPart && m.aids.length ? mergeMeshes([{ xyz: m.xyz, tri: m.tri }, ...m.aids]) : m;
          download(stlBinary(all.xyz, all.tri, p.id), `${fileName(p)}.stl`, 'model/stl');
        } }, t('ui.download'))));
    }
    dlg.append(el('h3', {}, t('stl.title')), el('p', {}, t('stl.ready')), list, close());
  } catch (e) {
    dlg.innerHTML = '';
    dlg.append(el('h3', {}, t('stl.failed')), el('p', {}, String(e.message).split('\n')[0]), close());
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
  if (snapshot() === JSON.stringify(Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) => !CAL_KEYS.includes(k))))) { toast(t('reset.already')); return; }
  remember();
  state.P = { ...DEFAULTS };
  applyProfile();                     // la calibración de la impresora se conserva
  safeDel(STORE);
  try { history.replaceState(null, '', location.pathname); } catch { /* límite del navegador */ }
  buildParams();
  runPack(true);
  schedule();
  toast(t('reset.done'), { action: t('ui.undo'), onAction: undo });
});
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
// Ctrl/⌘+Z y Ctrl/⌘+Mayús+Z (o Ctrl+Y). En un campo de texto manda el
// deshacer del propio campo.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  const tg = e.target;
  if (tg && (tg.isContentEditable || tg.tagName === 'TEXTAREA' || (tg.tagName === 'INPUT' && ['text', 'number', 'search'].includes(tg.type)))) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault();
  if (key === 'y' || e.shiftKey) redo(); else undo();
});
for (const r of document.querySelectorAll('.toolbar input[type=range]')) paintRange(r);
/* ------------------------------------------------------------------ */
/*  Idioma                                                            */
/* ------------------------------------------------------------------ */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
/** Textos fijos de index.html: data-i18n (texto), data-i18n-title, data-i18n-aria. */
function translateStatic() {
  for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of document.querySelectorAll('[data-i18n-title]')) n.title = t(n.dataset.i18nTitle);
  for (const n of document.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  $('#btnUndo').title = t(IS_MAC ? 'ui.undoKeyMac' : 'ui.undoKey');
  $('#btnRedo').title = t(IS_MAC ? 'ui.redoKeyMac' : 'ui.redoKey');
  document.querySelector('meta[name=description]')?.setAttribute('content', t('app.description'));
}
const langSel = $('#lang');
for (const { code, name } of langs()) langSel.append(el('option', { value: code, ...(code === lang() ? { selected: '' } : {}) }, name));
langSel.addEventListener('change', () => setLang(langSel.value));
// Cambiar de idioma no recalcula nada: los mensajes del motor ya son claves.
onLang(() => {
  langSel.value = lang();
  translateStatic();
  buildParams();
  if (state.result && shown.full) renderInfo(); else if (state.objects.length) updateContent();
  showStatusInfo();
  if (state.calBarInfo) $('#calbarText').textContent = t('status.calBar', state.calBarInfo);
  const b = $('#btnZip'); if (!b.disabled) b.textContent = t('ui.exportAll');
  updateBusy();
});
translateStatic();

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
