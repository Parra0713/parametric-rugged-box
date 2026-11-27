/**
 * calibProfile.js — Perfiles de calibración persistentes (localStorage).
 *
 * Un perfil = impresora + material ("Mi impresora · PLA"). Guarda los valores de
 * holgura (CAL_KEYS), de dónde sale cada uno (test / manual / por defecto),
 * el último test generado (para introducir los resultados días después de
 * imprimirlo) y un historial. El perfil activo se aplica a TODAS las cajas:
 * estos valores no viajan en el enlace compartido ni en los parámetros de la
 * caja, porque son de la impresora, no del diseño.
 */
import { DEFAULTS } from './engine/params.js';
import { CAL_KEYS } from './engine/calib.js';

const STORE_CAL = 'ruggedbox.calib.v1';
const DERIVED_FROM_C = ['axialGap', 'stackClr', 'insertTol', 'pocketTol'];

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const defaults = () => Object.fromEntries(CAL_KEYS.map((k) => [k, DEFAULTS[k]]));

function newProfile(name, values = defaults(), src = {}) {
  return { name, values: { ...defaults(), ...values }, src: { ...src }, plan: null, choices: {}, history: [], updated: Date.now() };
}

/**
 * Carga los perfiles. Si no hay ninguno, crea uno («Mi impresora» o su
 * traducción, `defaultName`) con los valores
 * que el usuario ya tuviera en sus parámetros guardados (versiones previas,
 * cuando las holguras eran parámetros normales de la caja).
 */
export function loadProfiles(savedP = {}, defaultName = 'Mi impresora') {
  let st = null;
  try { st = JSON.parse(safeGet(STORE_CAL) || 'null'); } catch { st = null; }
  if (!st || !st.profiles || !Object.keys(st.profiles).length) {
    const values = {}, src = {};
    for (const k of CAL_KEYS) {
      if (k in savedP && savedP[k] !== DEFAULTS[k]) { values[k] = savedP[k]; src[k] = 'manual'; }
    }
    st = { active: 'p1', profiles: { p1: newProfile(defaultName, values, src) } };
    safeSet(STORE_CAL, JSON.stringify(st));
  }
  for (const p of Object.values(st.profiles)) {
    p.values = { ...defaults(), ...p.values };
    p.src ||= {}; p.choices ||= {}; p.history ||= [];
  }
  if (!st.profiles[st.active]) st.active = Object.keys(st.profiles)[0];
  return st;
}

export function saveProfiles(st) { safeSet(STORE_CAL, JSON.stringify(st)); }

export const activeProfile = (st) => st.profiles[st.active];

export function addProfile(st, name, copyFrom) {
  const id = 'p' + Date.now().toString(36);
  st.profiles[id] = copyFrom
    ? { ...newProfile(name, copyFrom.values, copyFrom.src), calibrated: copyFrom.calibrated, history: [] }
    : newProfile(name);
  st.active = id;
  saveProfiles(st);
  return id;
}

export function removeProfile(st, id) {
  if (Object.keys(st.profiles).length <= 1) return false;
  delete st.profiles[id];
  st.active = Object.keys(st.profiles)[0];
  saveProfiles(st);
  return true;
}

/** Cambio manual de un valor desde la interfaz. */
export function setManual(st, k, v) {
  const p = activeProfile(st);
  p.values[k] = v;
  p.src[k] = 'manual';
  p.updated = Date.now();
  saveProfiles(st);
}

/** Aplica el resultado de un test (valores ya calculados por applyResults). */
export function setFromTest(st, res, plan, choices) {
  const p = activeProfile(st);
  for (const c of res.changes) { p.values[c.k] = c.to; }
  for (const k of CAL_KEYS) if (res.values[k] !== undefined) p.values[k] = res.values[k];
  // Medidos (aunque no cambien) → "test"; deducidos de la probeta C → "derived".
  for (const t of plan.tests) {
    if (choices[t.id] == null || choices[t.id] === '') continue;
    p.src[t.key] = 'test';
    if (t.piece === 'tongue') for (const k of DERIVED_FROM_C) p.src[k] = 'derived';
  }
  p.history.unshift({ date: Date.now(), summary: plan.summary, choices: { ...choices }, changes: res.changes, retest: res.retest });
  p.history = p.history.slice(0, 10);
  p.calibrated = Date.now();
  p.plan = res.retest ? p.plan : null;      // si hay que repetir, se conserva para ver qué se probó
  p.choices = {};
  p.updated = Date.now();
  saveProfiles(st);
}

export function resetProfile(st) {
  const p = activeProfile(st);
  const name = p.name;
  st.profiles[st.active] = newProfile(name);
  saveProfiles(st);
}
