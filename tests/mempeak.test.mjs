/**
 * Pico de memoria WASM de UNA construcción (Node):
 *   node tests/mempeak.test.mjs
 *
 * La memoria de WebAssembly nunca se devuelve al sistema: cada hilo de
 * geometría se queda para siempre con el máximo que llegó a necesitar. Por
 * eso no basta con que no haya fugas (perf.test.mjs): importa el PICO de la
 * caja más pesada. El motor libera cada pieza y cada etapa en cuanto deja de
 * hacer falta (`mark`/`release` en geo.js); esta prueba falla si un cambio
 * vuelve a dejar que los picos se sumen.
 *
 * Cada caso se mide en un proceso nuevo (memoria WASM recién estrenada).
 * Referencia v7.2 → v7.3: herramienta por celda inclinada 375 → 145 MB.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CRIMP = { innerL: 205, innerW: 100, baseDepth: 30, lidDepth: 15, lidMode: 'org', orgCols: 6, orgRows: 3, orgMinL: 33, orgMinW: 32, orgDepth: 26 };
// [nombre, parámetros, calidad, presupuesto en MB]
const CASES = [
  ['caja por defecto', {}, 'preview', 40],
  ['grande inclinada', { innerL: 260, innerW: 180, baseDepth: 63, lidDepth: 27, pattern: 'cross' }, 'preview', 70],
  ['herramienta, una tapa interior', { ...CRIMP, orgCover: 'single' }, 'preview', 110],
  ['herramienta por celda (inclinada)', { ...CRIMP, orgCover: 'cell' }, 'preview', 210],
  ['herramienta por celda + imanes', { ...CRIMP, orgCover: 'cell', orgLatch: 'magnet' }, 'preview', 260],
  ['compartimentos en base y tapa + imanes', { innerL: 150, innerW: 100, baseDepth: 40, lidDepth: 22, insertMode: 'org', orgBCols: 3, orgBRows: 2, orgBCover: 'cell', lidMode: 'org', orgCols: 3, orgRows: 2, orgCover: 'row', orgLatch: 'magnet' }, 'preview', 90],
  ['herramienta por celda, exportación', { ...CRIMP, orgCover: 'cell' }, 'final', 320],
];

const child = process.argv.find((a) => a.startsWith('--case='));
if (child) {
  // Proceso hijo: una construcción y su pico.
  const [, p, q] = CASES[Number(child.slice(7))];
  const { default: Module } = await import('manifold-3d');
  const { init, build } = await import('../src/engine/engine.js');
  const { DEFAULTS } = await import('../src/engine/params.js');
  await init(Module);
  const e0 = process.memoryUsage().external;
  const t0 = performance.now();
  const r = build({ ...DEFAULTS, ...p, quality: q }, null, { normals: q !== 'final' });
  const bad = r.parts.filter((x) => x.status !== 'NoError').length;
  console.log(JSON.stringify({ mb: (process.memoryUsage().external - e0) / 1e6, ms: performance.now() - t0, parts: r.parts.length, bad }));
  process.exit(0);
}

let fails = 0;
console.log('Pico de memoria por construcción (proceso nuevo por caso)');
const self = fileURLToPath(import.meta.url);
CASES.forEach(([name, , q, budget], i) => {
  const out = spawnSync(process.execPath, [self, `--case=${i}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  let m = null;
  try { m = JSON.parse(out.stdout.trim().split('\n').pop()); } catch { /* el hijo falló */ }
  const ok = !!m && m.bad === 0 && m.mb <= budget;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name} (${q === 'final' ? 'final' : 'modelo completo'}): ${m ? `${Math.round(m.mb)} MB ≤ ${budget} · ${m.parts} piezas · ${Math.round(m.ms)} ms` : 'el proceso falló: ' + String(out.stderr).split('\n').find((l) => /Error/.test(l))}`);
  if (!ok) fails++;
});
console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
