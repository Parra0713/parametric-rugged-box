/**
 * main.js — Interfaz: parámetros, comunicación con el motor, panel de medidas
 * y exportación.
 */
import { DEFAULTS, SCHEMA, BED_PRESETS } from './engine/params.js';
import { EngineClient } from './engineClient.js';
import { Viewer } from './viewer.js';
import { parseSVG, placeSVG } from './svg.js';
import { transformVerts, hull2D, fitAngle, tiltSolve, packPlates } from './bedfit.js';
import { stlBinary, mergeMeshes, zipStore, download } from './export.js';

/* ------------------------------------------------------------------ */
/*  Estado                                                            */
/* ------------------------------------------------------------------ */
const STORE = 'ruggedbox.params.v1';
const STORE_SVG = 'ruggedbox.svg.v1';

function loadParams() {
  let saved = {};
  try {
    if (location.hash.length > 1) saved = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    else saved = JSON.parse(localStorage.getItem(STORE) || '{}');
  } catch { saved = {}; }
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
  renderInfo();
  const sp = $('#sectionPos');
  sp.min = -Math.ceil(msg.r.D.Lband / 2); sp.max = Math.ceil(msg.r.D.Lband / 2);
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
    const tilt = fit.ok ? null : tiltSolve(xyz, B);
    fits[p.id] = { ...fit, tilt, tooTall: zMax > B.z, height: zMax };
    for (let k = 0; k < p.instances.length; k++) {
      items.push({ partId: p.id, angle: fit.angle, fit, label: p.name });
    }
  }
  const plates = packPlates(items, { x: B.x - 2 * EDGE, y: B.y - 2 * EDGE }).map((pl) => ({
    items: pl.items.map((it) => ({
      partId: it.partId, angle: it.angle,
      tx: it.x - it.fit.x0 + EDGE, ty: it.y - it.fit.y0 + EDGE,
    })),
  }));
  return { fits, plates };
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
      ['Profundidad tapa', mm(I.lidDepth)],
      ['Alto total cerrada', mm(I.closedHeight), true],
      ['Chaflán suelo/pared', mm(I.floorChamfer)],
    ]),
    el('p', { class: 'small' }, `Inserto: L ≤ ${I.L - 0.4} mm, W ≤ ${I.W - 0.4} mm (0.2 mm de holgura por lado), radio ≥ ${I.inner_corner_radius} mm y chaflán inferior ≥ ${I.floorChamfer} mm.`)));

  info.append(el('section', { class: 'card' }, el('h3', {}, 'Exterior'),
    kv([['Envolvente', `${D.outerL} × ${D.outerW} × ${D.outerH} mm`], ['Pared / banda', `${D.t} / ${D.bo} mm`]])));

  const pin = D.pinMode === 'filament'
    ? `Filamento 1.75 mm: ${D.filament.hingeQty}× ${D.filament.hinge} mm + ${D.filament.latchQty}× ${D.filament.latch} mm`
    : `Impreso Ø${D.pinD} mm (snap, acostado)`;
  info.append(el('section', { class: 'card' }, el('h3', {}, 'Mecánica adaptativa'),
    kv([
      ['Clase', D.cls === 'S' ? 'S — pequeña' : D.cls === 'M' ? 'M — mediana' : 'L — grande'],
      ['Bisagras', `${D.hinge.n} × ${D.hinge.nk} nudillos (${D.hinge.len} mm)`],
      ['Cierres', `${D.latch.n} de gancho autobloqueante`],
      ['Taladro', `Ø${D.holeD} mm teardrop`],
    ]),
    el('p', { class: 'small' }, pin)));

  const seal = D.sealMode === 'tpu'
    ? [['Ranura', `${D.gw} × ${D.gd} mm`], ['Junta TPU', `${D.gkw} × ${D.gkh} mm`],
      ['Compresión', `${Math.round(D.c * 100)} %`, true], ['Llenado', `${Math.round(D.fill * 100)} % (≤ 85 %)`]]
    : D.sealMode === 'labyrinth'
      ? [['Ranuras', `2 × ${D.gw} × ${D.gd} mm`], ['Lengüetas', `${D.tl} mm, holgura ${D.clr} mm`]]
      : [['Ranura', `${D.gw} × ${D.gd} mm`], ['Lengüeta', `${D.tl} mm`]];
  info.append(el('section', { class: 'card' }, el('h3', {}, 'Sellado'), kv(seal)));

  const B = bed();
  const fitRows = parts.map((p) => {
    const f = state.layout.fits[p.id];
    let txt = f.ok ? (f.mode === 'diagonal' ? `diagonal ${f.angle}°` : f.mode) : 'no cabe plana';
    if (!f.ok && f.tilt?.ok) txt = `inclinar ${f.tilt.alpha}° sobre ${f.tilt.axis} + giro ${f.tilt.angle}° (soportes)`;
    if (!f.ok && !f.tilt?.ok) txt = 'no cabe: reduce medidas';
    if (f.tooTall) txt += ' · excede Z';
    return [p.name, txt, f.mode === 'diagonal'];
  });
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
  return { xyz, tri: p.mesh.tri, w: x1 - x0, h: y1 - y0 };
}

const FILE = { base: 'base', lid: 'tapa', latch: 'cierre', gasket: 'junta_TPU', hingePin: 'pasador_bisagra', latchPin: 'pasador_cierre', cap: 'tapon_pasador' };

async function exportZip() {
  const btn = $('#btnZip');
  btn.disabled = true; btn.textContent = 'Generando…';
  try {
    const r = await finalBuild();
    const layout = computeLayout(r);
    const files = [];
    for (const p of r.parts) {
      const m = printMesh(p, layout.fits[p.id].angle);
      files.push({ name: `piezas/${FILE[p.id]}_x${p.instances.length}.stl`, data: stlBinary(m.xyz, m.tri, p.id) });
    }
    const B = bed();
    const byId = Object.fromEntries(r.parts.map((p) => [p.id, p]));
    layout.plates.forEach((pl, k) => {
      const meshes = pl.items.map((it) => {
        const p = byId[it.partId];
        const xyz = transformVerts(p.mesh.vert, p.mesh.numProp, p.print);
        const a = (it.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        for (let i = 0; i < xyz.length; i += 3) {
          const x = xyz[i], y = xyz[i + 1];
          xyz[i] = c * x - s * y + it.tx - B.x / 2;
          xyz[i + 1] = s * x + c * y + it.ty - B.y / 2;
        }
        return { xyz, tri: p.mesh.tri };
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

function readme(r, layout) {
  const D = r.D;
  const lines = [
    'RUGGED BOX — instrucciones de impresión y montaje',
    '='.repeat(50), '',
    `Interior: ${D.inner.L} × ${D.inner.W} mm, alto cerrado ${D.inner.closedHeight} mm, inner_corner_radius ${D.inner.inner_corner_radius} mm`,
    `Exterior: ${D.outerL} × ${D.outerW} × ${D.outerH} mm`, '',
    'PIEZAS (ya orientadas para imprimir, sin soportes):',
    ...r.parts.map((p) => `  - ${p.name} × ${p.instances.length}  [${p.material}]  → orientación: ${layout.fits[p.id].ok ? layout.fits[p.id].mode + (layout.fits[p.id].mode === 'diagonal' ? ' ' + layout.fits[p.id].angle + '°' : '') : 'NO CABE'}`),
    '',
    'AJUSTES RECOMENDADOS:',
    '  - Base/tapa: 0.2 mm de capa, 4–6 perímetros, 15–25 % de relleno gyroid.',
    '  - Cierres: imprimir acostados (como vienen), 100 % de perímetros o 5+ paredes, PETG preferible (más elástico).',
    '  - Pasadores: acostados sobre la cara plana, 100 % de relleno.',
    '  - Junta: TPU 95A, 0.2 mm, velocidad baja, 100 % de relleno.',
    '  - Tapa: la cara decorada va contra la cama.', '',
    'MONTAJE:',
    '  1. Coloca la junta TPU en la ranura de la base (si aplica).',
    '  2. Alinea los nudillos de la tapa entre los de la base e inserta el pasador por el lado de la cabeza hasta que los dientes salten.',
    '  3. Coloca cada cierre entre sus orejetas e inserta su pasador.',
  ];
  if (D.pinMode === 'filament') {
    lines.push(`  * Pasadores de filamento 1.75 mm: corta ${D.filament.hingeQty}× ${D.filament.hinge} mm (bisagra) y ${D.filament.latchQty}× ${D.filament.latch} mm (cierres); fíjalos con los tapones a presión.`);
  }
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
          const m = printMesh(p, layout.fits[p.id].angle);
          download(stlBinary(m.xyz, m.tri, p.id), `${FILE[p.id]}.stl`, 'model/stl');
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
