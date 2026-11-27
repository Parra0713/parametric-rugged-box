/**
 * merge.js — Une los resultados de los dos hilos de geometría.
 *
 * El motor puede construir solo el grupo A (base, junta, inserto de la base,
 * tapas interiores de la tapa) o el B (tapa, cierres, pasadores, inserto de
 * la tapa, tapas interiores de la base); cada hilo calcula su
 * mitad en paralelo y aquí se recompone el mismo resultado que daría
 * `build()` completo: piezas en el orden canónico, avisos y registro sin
 * duplicados (los de `derive()` salen en ambos).
 */
const ORDER = ['base', 'lid', 'latch', 'orgPanel', 'gasket', 'insert', 'insertLid', 'hingePin', 'latchPin', 'cap'];

// Sin repetidos (los avisos son mensajes {k, p}: se comparan por su contenido).
const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = typeof x === 'string' ? x : JSON.stringify(x); return seen.has(k) ? false : seen.add(k); }); };

export function mergeResults(a, b) {
  const rank = (p) => { const i = ORDER.indexOf(p.id); return i < 0 ? ORDER.length : i; };
  const parts = [...a.parts, ...b.parts]
    .map((p, i) => ({ p, i }))
    .sort((x, y) => rank(x.p) - rank(y.p) || x.i - y.i)
    .map((x) => x.p);
  const D = { ...a.D };
  D.warn = uniq([...(a.D.warn || []), ...(b.D.warn || [])]);
  D.log = uniq([...(a.D.log || []), ...(b.D.log || [])]);
  D.hullLine = [...(a.D.hullLine || []), ...(b.D.hullLine || [])]
    .filter((r, i, arr) => arr.findIndex((q) => JSON.stringify(q) === JSON.stringify(r)) === i);
  D.filament = { ...(a.D.filament || {}), ...(b.D.filament || {}) };
  if (b.D.insert && !a.D.insert) D.insert = b.D.insert;
  if (b.D.insertLid && !a.D.insertLid) D.insertLid = b.D.insertLid;
  if (b.D.cord && !a.D.cord) D.cord = b.D.cord;
  return { ...a, D, parts, ms: Math.max(a.ms, b.ms), only: null };
}
