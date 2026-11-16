/**
 * Pruebas de rendimiento y de las cachés del motor (Node):
 *   node tests/perf.test.mjs
 *
 * 1. Memoria: reconstruir muchas veces NO hace crecer la memoria WASM (antes
 *    se perdían ~30 MB por reconstrucción y el hilo acababa en "memory
 *    access out of bounds", con cambios que dejaban de aplicarse).
 * 2. Reparto en dos hilos: build(only:'A') + build(only:'B') unidos con
 *    mergeResults dan las mismas piezas que build() completo.
 * 3. Vista rápida ('draft'): piezas válidas, de un solo sólido y más rápida.
 * 4. Caché de la base: ningún parámetro marcado como "solo tapa" cambia la
 *    base (si lo hiciera, la vista mostraría una base vieja).
 * 5. Caché de ayudas de impresión: reutilizar da lo mismo que recalcular y
 *    cambiar un parámetro de las ayudas sí las recalcula.
 */
import Module from 'manifold-3d';
import { init, build, _internal } from '../src/engine/engine.js';
import { mergeResults } from '../src/engine/merge.js';
import { DEFAULTS, SCHEMA } from '../src/engine/params.js';

await init(Module);
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✔' : '  ✘'} ${msg}`); if (!ok) fails++; };
const sig = (r) => r.parts.map((p) => `${p.key}:${p.tris}:${p.volume}:${(p.aids || []).map((a) => a.mesh.tri.length).join('+')}`).join(' ');

/* 1. Memoria ------------------------------------------------------- */
console.log('\nMemoria WASM');
{
  const ext = () => process.memoryUsage().external / 1e6;
  const P0 = { ...DEFAULTS, pattern: 'hex', stackable: true };
  for (let i = 0; i < 4; i++) build({ ...P0, innerL: 100 + i }, null);
  const a = ext();
  for (let i = 0; i < 25; i++) build({ ...P0, innerL: 104 + i * 0.5, stackable: i % 2 === 0, quality: i % 3 ? 'draft' : 'preview' }, null);
  const grow = ext() - a;
  check(grow < 40, `25 reconstrucciones: la memoria crece ${grow.toFixed(1)} MB (< 40; antes ~750 MB)`);
  // Lo nuevo (compartimentos en las dos mitades, imanes, huecos en la tapa,
  // junta de cordón) tampoco deja nada vivo en WASM.
  const poly = [[[-40, -15], [40, -15], [40, 15], [-40, 15]]];
  const mix = (i) => ({ ...DEFAULTS, innerL: 140 + (i % 5), innerW: 95, baseDepth: 38, lidDepth: 20,
    insertMode: ['org', 'pockets', 'blank'][i % 3], lidMode: ['org', 'org', 'pockets'][i % 3], contentPolys: poly,
    orgCols: 3, orgRows: 2, orgBCols: 3, orgBRows: 2, orgCover: ['row', 'cell', 'single'][i % 3], orgBCover: ['cell', 'row', 'single'][i % 3],
    orgLatch: i % 2 ? 'magnet' : 'snap', sealMode: i % 4 === 0 ? 'cord' : 'tpu', quality: i % 3 ? 'draft' : 'preview' });
  for (let i = 0; i < 6; i++) build(mix(i), null);
  const b0 = ext();
  for (let i = 6; i < 30; i++) build(mix(i), null);
  const grow2 = ext() - b0;
  check(grow2 < 40, `24 reconstrucciones con compartimentos, imanes, huecos y cordón: crece ${grow2.toFixed(1)} MB (< 40)`);
}

/* 2. Reparto A/B ---------------------------------------------------- */
console.log('\nReparto en dos hilos (A + B = completo)');
const splitCases = [
  ['normal', {}],
  ['apilable + insertos', { stackable: true, insertMode: 'blank', lidMode: 'blank' }],
  ['pasadores impresos', { pinMode: 'printed', latchPinMode: 'printed' }],
  ['junta en tramos (cama pequeña)', { innerL: 200, innerW: 120, bedPreset: 'custom', bedX: 180, bedY: 180 }],
  ['grande inclinada', { innerL: 260, innerW: 180, baseDepth: 63, lidDepth: 27, pattern: 'cross' }],
  ['organizador por celda', { lidMode: 'org', orgCols: 4, orgRows: 2, orgCover: 'cell' }],
  ['compartimentos en base y tapa + imanes', { innerL: 150, innerW: 100, baseDepth: 40, lidDepth: 22, insertMode: 'org', orgBCols: 3, orgBRows: 2, orgBCover: 'cell', lidMode: 'org', orgCols: 3, orgRows: 2, orgCover: 'row', orgLatch: 'magnet' }],
  ['huecos en base y tapa + cordón', { innerL: 150, innerW: 90, lidDepth: 18, insertMode: 'pockets', lidMode: 'pockets', sealMode: 'cord', contentPolys: [[[-50, -20], [50, -20], [50, 20], [-50, 20]]] }],
];
for (const [name, p] of splitCases) {
  for (const q of ['draft', 'preview']) {
    const P = { ...DEFAULTS, ...p, quality: q };
    const full = build(P, null);
    const m = mergeResults(build(P, null, { only: 'A' }), build(P, null, { only: 'B' }));
    const sameWarn = JSON.stringify([...full.D.warn].sort()) === JSON.stringify([...m.D.warn].sort());
    const extra = (r) => JSON.stringify([r.D.filament, r.D.cord || null, r.D.insert || null, r.D.insertLid || null, r.parts.map((x) => [x.key, x.side || '', x.axis || null])]);
    check(sig(full) === sig(m) && sameWarn && extra(full) === extra(m),
      `${name} (${q}): ${m.parts.length} piezas iguales`);
  }
}

/* 3. Vista rápida --------------------------------------------------- */
console.log('\nVista rápida');
for (const [name, p] of [['normal', {}], ['apilable octógono', { stackable: true, cornerCut: 15, innerL: 160, innerW: 90 }],
  ['XS 20×20', { innerL: 20, innerW: 20, baseDepth: 15, lidDepth: 5 }], ['Gridfinity', { gridfinity: 'baseplate', innerL: 168.5, innerW: 84.5 }]]) {
  const P = { ...DEFAULTS, ...p };
  const d = build({ ...P, quality: 'draft', innerW: (P.innerW || 80) + 0.25 }, null);
  const f = build({ ...P, quality: 'preview', innerW: (P.innerW || 80) + 0.5 }, null);
  const bad = d.parts.filter((x) => x.status !== 'NoError' || (x.components > 1 && x.id !== 'gasket'));
  check(!bad.length, `${name}: piezas válidas en vista rápida${bad.length ? ' — ' + bad.map((x) => x.name).join(', ') : ''}`);
  const tD = d.parts.reduce((s, x) => s + x.tris, 0), tF = f.parts.reduce((s, x) => s + x.tris, 0);
  check(tD < tF, `${name}: menos triángulos (${tD} < ${tF}) · ${d.ms} ms frente a ${f.ms} ms`);
}

/* 4. Caché de la base ----------------------------------------------- */
console.log('\nCaché de la base (parámetros "solo tapa")');
{
  const items = SCHEMA.flatMap((g) => g.items || []);
  const wrong = [];
  const ORG_B = { insertMode: 'org', orgBCols: 3, orgBRows: 2, baseDepth: 38 };
  for (const B of [{}, { stackable: true, lidMin: true }, { lidMode: 'org', orgCols: 3, orgRows: 2 }, { stackable: true, lidMode: 'org', orgCols: 3, orgRows: 2, orgLatch: 'magnet' },
    { ...ORG_B, orgBCover: 'cell', orgLatch: 'magnet' }]) {
    for (const k of _internal.LID_ONLY) {
      const it = items.find((i) => i.k === k);
      if (!it) continue;
      let alt;
      if (it.type === 'range') alt = Math.min(it.max, (DEFAULTS[k] ?? it.min) + 3 * it.step + (k === 'lidDepth' ? 10 : 0) + (k === 'top' ? 1 : 0));
      else if (it.type === 'select') alt = it.options.map((o) => o[0]).find((v) => v !== DEFAULTS[k]);
      else alt = !DEFAULTS[k];
      const P1 = { ...DEFAULTS, ...B, quality: 'draft' }, P2 = { ...P1, [k]: alt };
      const base = (r) => { const b = r.parts.find((x) => x.id === 'base'); return `${b.volume}/${b.tris}`; };
      build(P1, null, { only: 'A' });
      const cached = base(build(P2, null, { only: 'A' }));
      build({ ...P1, innerL: 77 }, null, { only: 'A' });
      const fresh = base(build(P2, null, { only: 'A' }));
      if (cached !== fresh) wrong.push(`${k}=${alt}${B.stackable ? ' (apilable)' : ''}${B.lidMode ? ' (tapa con compartimentos)' : ''}${B.insertMode ? ' (base con compartimentos)' : ''}`);
    }
  }
  check(!wrong.length, `ningún parámetro "solo tapa" cambia la base${wrong.length ? ': ' + wrong.join(', ') : ''}`);
}

/* 4b. Caché de la tapa ---------------------------------------------- */
console.log('\nCaché de la tapa (parámetros que no la tocan)');
{
  const items = SCHEMA.flatMap((g) => g.items || []);
  const wrong = [];
  const crimp = [[[-60, -20], [60, -20], [60, 20], [-60, 20]]];
  for (const B of [{}, { stackable: true }, { lidMode: 'org', orgCols: 3, orgRows: 2 }, { insertMode: 'pockets', contentPolys: crimp },
    { insertMode: 'org', orgBCols: 3, orgBRows: 2, baseDepth: 38 }, { insertMode: 'org', orgBCols: 3, orgBRows: 2, baseDepth: 38, lidMode: 'org', orgLatch: 'magnet' },
    { lidMode: 'pockets', contentPolys: crimp }]) {
    for (const k of _internal.NOT_LID) {
      const it = items.find((i) => i.k === k);
      let alt;
      if (k === 'contentPolys') alt = [[[-50, -15], [50, -15], [50, 15], [-50, 15]]];
      else if (!it) continue;
      else if (it.type === 'range') alt = Math.min(it.max, (DEFAULTS[k] ?? it.min) + 3 * it.step);
      else if (it.type === 'select') alt = it.options.map((o) => o[0]).find((v) => v !== (B[k] ?? DEFAULTS[k]));
      else alt = !(B[k] ?? DEFAULTS[k]);
      const P1 = { ...DEFAULTS, ...B, quality: 'draft' }, P2 = { ...P1, [k]: alt };
      const lid = (r) => { const b = r.parts.find((x) => x.id === 'lid'); return `${b.volume}/${b.tris}/${b.mesh.vert.length}`; };
      build(P1, null, { only: 'B' });
      const cached = lid(build(P2, null, { only: 'B' }));
      build({ ...P1, innerL: 77 }, null, { only: 'B' });
      const fresh = lid(build(P2, null, { only: 'B' }));
      if (cached !== fresh) wrong.push(`${k}=${JSON.stringify(alt)}${B.insertMode ? ` (base: ${B.insertMode})` : ''}`);
    }
  }
  // Los compartimentos de la base SÍ cambian la tapa cuando agrandan la caja
  // o suben el plano de unión: ahí la caché no debe acertar.
  {
    const P1 = { ...DEFAULTS, insertMode: 'org', orgBCols: 3, orgBRows: 2, quality: 'draft' };
    const lidOf = (P) => { const b = build(P, null, { only: 'B' }).parts.find((x) => x.id === 'lid'); return `${b.volume}/${b.tris}`; };
    const a1 = lidOf(P1), a2 = lidOf({ ...P1, orgBMinL: 60 }), a3 = lidOf({ ...P1, orgBDepth: 50 });
    check(a1 !== a2 && a1 !== a3, 'compartimentos de la base que agrandan la caja o la base: la tapa se recalcula');
  }
  // El logo forma parte de la clave de la tapa (antes cambiar de logo con
  // los mismos parámetros devolvía la tapa del logo anterior).
  {
    const logo = (w) => ({ fills: [{ outer: [[-w, -8], [w, -8], [w, 8], [-w, 8]], holes: [] }], strokes: [] });
    const P1 = { ...DEFAULTS, pattern: 'none', quality: 'draft' };
    const lidOf = (svg) => { const b = build(P1, svg, { only: 'B' }).parts.find((x) => x.id === 'lid'); return `${b.volume}/${b.tris}`; };
    const l1 = lidOf(logo(12)), l2 = lidOf(logo(22)), l1b = lidOf(logo(12)), l0 = lidOf(null);
    check(l1 !== l2 && l1 === l1b && l0 !== l1, 'cambiar de logo rehace la tapa; volver al anterior da la misma');
  }
  check(!wrong.length, `ningún parámetro de contenido/inserto/ayudas cambia la tapa${wrong.length ? ': ' + wrong.join(', ') : ''}`);
  // Y la caché acelera de verdad el hilo B al tocar el inserto.
  const P = { ...DEFAULTS, lidMode: 'org', orgCols: 6, orgRows: 3, insertMode: 'blank', quality: 'draft' };
  build(P, null, { only: 'B' });
  const t0 = performance.now(); build({ ...P, insertTol: 0.4 }, null, { only: 'B' }); const tHit = performance.now() - t0;
  const t1 = performance.now(); build({ ...P, innerW: 81 }, null, { only: 'B' }); const tMiss = performance.now() - t1;
  check(tHit < tMiss * 0.5, `tocar el inserto no recalcula la tapa (${Math.round(tHit)} ms frente a ${Math.round(tMiss)} ms)`);
}

/* 5. Caché de ayudas ------------------------------------------------ */
console.log('\nCaché de ayudas de impresión');
{
  // La tapa de esta caja se imprime inclinada (aletas + soportes de voladizos).
  const P = { ...DEFAULTS, innerL: 260, innerW: 180, baseDepth: 63, lidDepth: 27, pattern: 'cross' };
  const t0 = performance.now();
  const ref = build(P, null, { only: 'B' });
  const tRef = performance.now() - t0;
  const lid = ref.parts.find((x) => x.id === 'lid');
  check(!!lid.tilt && lid.aids.length > 1, `tapa inclinada con ayudas (${lid.aids.map((a) => a.name).join(', ')})`);
  build({ ...P, innerL: 250 }, null, { only: 'B' });                    // otra caja entre medias
  const t1 = performance.now();
  const again = build(P, null, { only: 'B' });                          // vuelve: ayudas en caché
  const tAgain = performance.now() - t1;
  check(sig(ref) === sig(again) && JSON.stringify(again.parts[0].tilt) === JSON.stringify(lid.tilt),
    `ayudas reutilizadas idénticas (${Math.round(tAgain)} ms frente a ${Math.round(tRef)} ms)`);
  check(tAgain < tRef * 0.6, 'reutilizar las ayudas es claramente más rápido');
  const other = build({ ...P, finSpacing: (P.finSpacing || 40) + 10 }, null, { only: 'B' });
  check(sig(other) !== sig(ref), 'cambiar la separación de aletas recalcula las ayudas');
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
