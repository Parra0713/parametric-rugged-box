/**
 * Idiomas de la interfaz.
 *
 * AÑADIR UN IDIOMA
 *   1. `node scripts/i18n.mjs new fr` crea src/i18n/locales/fr.js con todas
 *      las claves y el texto en inglés como punto de partida.
 *   2. Tradúcelo (usa el vocabulario del hobby: «slicer», «brim», «infill»…
 *      como se dicen en ese idioma en los foros de impresión 3D).
 *   3. Añade una línea en LOCALES (abajo).
 *   4. `node scripts/i18n.mjs check` y `npm run test:guide` deben pasar.
 *
 * Idioma de origen: español. Los textos de los ajustes viven en SCHEMA
 * (src/engine/params.js) y el resto en locales/es.js. Si a un idioma le falta
 * una clave se usa el inglés y, si tampoco está, el español.
 *
 * Un valor del diccionario es un texto con huecos `{nombre}` o una función
 * `(p, h) => texto` cuando hace falta lógica (plurales, frases opcionales).
 * `h` trae utilidades del idioma: h.n (número), h.mm, h.dims, h.pl (plural),
 * h.list (enumeración), h.t / h.tm (otras claves y mensajes).
 */
import es from './locales/es.js';
import en from './locales/en.js';
import { isMsg } from './msg.js';

export { M, isMsg } from './msg.js';

/** Idiomas disponibles, en el orden del selector. */
export const LOCALES = { es, en };

const STORE = 'ruggedbox.lang';
let cur = 'es';
const listeners = new Set();

export const lang = () => cur;
export const langs = () => Object.entries(LOCALES).map(([code, d]) => ({ code, name: d['meta.name'] }));

/**
 * Idioma inicial: ?lang=xx en la dirección, luego el elegido la última vez y
 * luego el del navegador; si no hay ninguno disponible, inglés.
 */
export function detectLang() {
  const ok = (c) => (c && LOCALES[c] ? c : null);
  let url = null, saved = null;
  try { url = new URLSearchParams(location.search).get('lang'); } catch { /* sin location */ }
  try { saved = localStorage.getItem(STORE); } catch { /* sin almacenamiento */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  return ok(url) || ok(saved) || nav.map((l) => ok(String(l).toLowerCase().split('-')[0])).find(Boolean) || 'en';
}

export function setLang(code, { persist = true } = {}) {
  if (!LOCALES[code]) return;
  cur = code;
  if (persist) { try { localStorage.setItem(STORE, code); } catch { /* idem */ } }
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  for (const f of listeners) f(code);
}
export const onLang = (f) => { listeners.add(f); return () => listeners.delete(f); };

/* ---------------- Números ---------------- */
const NB = ' ';                      // espacio duro: la unidad no se separa de su cifra
const nf = {};
/** Número en el formato del idioma (coma o punto decimal), hasta 2 decimales. */
export const fmtN = (v, max = 2) => {
  const key = cur + max;
  nf[key] ??= new Intl.NumberFormat(LOCALES[cur]['meta.locale'] || cur, { maximumFractionDigits: max, useGrouping: false });
  return nf[key].format(Number(v));
};
export const mm = (v) => `${fmtN(v)}${NB}mm`;
/** «a × b × c mm» sin saltos de línea por dentro. */
export const dims = (...v) => `${v.map((x) => fmtN(x)).join(`${NB}×${NB}`)}${NB}mm`;

/* ---------------- Textos ---------------- */
const H = {
  n: (v, max) => fmtN(v, max), mm, dims, NB,
  pl: (n, one, other) => (Number(n) === 1 ? one : other),
  list: (arr) => {
    const a = arr.filter(Boolean);
    if (a.length < 2) return a.join('');
    return `${a.slice(0, -1).join(', ')} ${LOCALES[cur]['meta.and'] || 'y'} ${a[a.length - 1]}`;
  },
  t: (k, p) => t(k, p),
  tm: (m) => tm(m),
};

/**
 * Orden de búsqueda: idioma actual → inglés → español. El español de los
 * ajustes no está en es.js sino en SCHEMA (llega como `fallback`), así que en
 * español va antes que el inglés.
 */
function lookup(key, fallback) {
  const own = LOCALES[cur][key];
  if (own !== undefined) return own;
  if (cur === 'es' && fallback !== undefined) return fallback;
  return LOCALES.en[key] ?? LOCALES.es[key] ?? fallback;
}

/** Rellena `{x}` con los datos (los mensajes anidados se traducen). */
function fill(s, p = {}) {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? str(p[k]) : m));
}
const str = (v) => (isMsg(v) ? tm(v) : Array.isArray(v) ? H.list(v.map(str)) : typeof v === 'number' ? fmtN(v) : String(v));

/**
 * Texto de una clave. `fallback` (opcional) se usa si ningún idioma la tiene
 * (los textos de SCHEMA, que son la fuente en español).
 */
export function t(key, p, fallback) {
  const v = lookup(key, fallback);
  if (v === undefined) {
    if (typeof console !== 'undefined') console.warn(`[i18n] falta la clave «${key}»`);
    return key;
  }
  if (typeof v === 'function') return v(p || {}, H);
  if (Array.isArray(v)) return v.map((x) => fill(String(x), p));   // varias líneas
  return typeof v === 'string' ? fill(v, p) : v;
}

/** ¿Existe la clave en el idioma actual (sin caer en otro)? */
export const has = (key, code = cur) => LOCALES[code][key] !== undefined;

/** Texto de un mensaje del motor (`{k, p}`) o de un texto ya hecho. */
export function tm(m) {
  if (m == null) return '';
  if (isMsg(m)) return t(m.k, m.p);
  return String(m);
}

/* ---------------- Textos del esquema de ajustes ---------------- */
/*
 * Claves: tab.<id>, tab.<id>.sub, g.<grupo>, s.<grupo>.<ajuste>,
 * s.<grupo>.<ajuste>.hint, s.<grupo>.<ajuste>.o.<valor>. El español sale de
 * SCHEMA; los demás idiomas, de su diccionario. Un ajuste con `names: true`
 * tiene nombres propios como opciones (modelos de impresora): no se traducen.
 */
export const tabText = (tab, field = 'label') => t(field === 'sub' ? `tab.${tab[0]}.sub` : `tab.${tab[0]}`, null, field === 'sub' ? tab[2] : tab[1]);
export const groupText = (g) => t(`g.${g.id}`, null, g.group);
export const itemText = (g, it, field = 'label') => {
  if (field === 'hint' && !it.hint) return '';
  return t(`s.${g.id}.${it.k}${field === 'hint' ? '.hint' : ''}`, null, it[field]);
};
export const optionText = (g, it, val, txt) => (it.names && val !== 'custom' ? txt : t(`s.${g.id}.${it.k}.o.${val}`, null, txt));

/** Todas las claves del esquema con su texto en español (para las pruebas y el script). */
export function schemaKeys(TABS, SCHEMA) {
  const out = {};
  for (const tb of TABS) { out[`tab.${tb[0]}`] = tb[1]; out[`tab.${tb[0]}.sub`] = tb[2]; }
  for (const g of SCHEMA) {
    out[`g.${g.id}`] = g.group;
    for (const it of g.items) {
      out[`s.${g.id}.${it.k}`] = it.label;
      if (it.hint) out[`s.${g.id}.${it.k}.hint`] = it.hint;
      for (const [v, txt] of it.options || []) if (String(txt) !== String(v) && !(it.names && v !== 'custom')) out[`s.${g.id}.${it.k}.o.${v}`] = txt;
    }
  }
  return out;
}
