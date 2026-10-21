/**
 * Montaje real y "sin soportes" en toda la gama.
 *
 *   node tests/assembly.test.mjs
 *
 * 1. Pasadores: tamaños de 20 a 320 mm × {filamento, impreso} × {TPU,
 *    laberinto}: tapones y pasadores no se solapan con la caja, la tapa abre
 *    sin tocarlos, se pueden colocar y el filamento entra recto.
 * 2. Sin soportes: tapa con cada patrón (grabado y relieve) y apilable en
 *    varias formas: ningún puente de las piezas planas supera 10 mm.
 * 3. Apilado: la base de arriba asienta y queda bloqueada.
 */
import Module from 'manifold-3d';
import { init, build, _internal } from '../src/engine/engine.js';
import { DEFAULTS, derive } from '../src/engine/params.js';
import { pinChecks, bridgeChecks } from './lib/assembly.mjs';

await init(Module);
const { hinges, latches, buildBase, buildLid } = _internal;
let fails = 0, checks = 0;

function run(name, p, { pins = true, bridges = false, stack = false } = {}) {
  const P = { ...DEFAULTS, ...p };
  const r = build(P, null, { normals: false });
  const D = derive(P);
  const H = hinges(D), L = latches(D);
  const base = buildBase(D, H, L, []);
  const lid = buildLid(D, P, H, L, null, []).lid;
  const res = [];
  if (pins) res.push(...pinChecks(r, D, base, lid));
  if (bridges) res.push(...bridgeChecks(r, r.D.maxBridge));
  if (stack) {
    const z = D.Hb + D.Hl;
    const v0 = base.translate([0, 0, z]).intersect(lid).volume();
    const vx = base.translate([0.6, 0, z]).intersect(lid).volume();
    const vy = base.translate([0, 0.6, z]).intersect(lid).volume();
    res.push({ ok: v0 < 0.05 && vx > 1 && vy > 1, msg: `apilado: asienta (${v0.toFixed(2)}) y bloquea X (${vx.toFixed(0)}) e Y (${vy.toFixed(0)})` });
  }
  const bad = res.filter((x) => !x.ok);
  checks += res.length; fails += bad.length;
  console.log(`${bad.length ? '✘' : '✔'} ${name} (${res.length} comprobaciones)${bad.length ? '\n    ' + bad.map((x) => x.msg).join('\n    ') : ''}`);
  _internal.cleanup();
}

console.log('— Pasadores y tapones —');
const SIZES = [[20, 20, 10, 4], [30, 25, 15, 5], [45, 30, 18, 6], [60, 40, 21, 9], [90, 60, 30, 10], [120, 80, 35, 15], [200, 140, 45, 15], [320, 220, 40, 15]];
for (const [L, W, bd, ld] of SIZES) for (const pinMode of ['filament', 'printed']) for (const sealMode of ['tpu', 'labyrinth']) {
  run(`${L}×${W} ${pinMode === 'filament' ? 'filamento' : 'impresos'} ${sealMode}`, { innerL: L, innerW: W, baseDepth: bd, lidDepth: ld, pinMode, sealMode });
}
run('120×80 octógono + filamento', { cornerCut: 18, pinMode: 'filament' });
run('25×120 girada + impresos', { innerL: 25, innerW: 120, baseDepth: 20, lidDepth: 5, pinMode: 'printed' });

console.log('\n— Sin soportes (piezas planas, puente ≤ 10 mm) —');
for (const pattern of ['smooth', 'hex', 'stripes', 'cross', 'circuit', 'radial']) for (const relief of ['engrave', 'emboss']) {
  if (pattern === 'smooth' && relief === 'emboss') continue;
  run(`tapa ${pattern} ${relief === 'engrave' ? 'grabado' : 'relieve'}`, { pattern, relief }, { pins: false, bridges: true });
}
run('patrón hexagonal de 20 mm', { pattern: 'hex', patternSize: 20 }, { pins: false, bridges: true });

console.log('\n— Apilable —');
for (const [name, p] of [
  ['20×20', { innerL: 20, innerW: 20, baseDepth: 10, lidDepth: 4 }],
  ['60×40', { innerL: 60, innerW: 40, baseDepth: 21, lidDepth: 9 }],
  ['120×80', {}],
  ['120×80 octógono', { cornerCut: 18 }],
  ['160×100 + Gridfinity interior', { innerL: 168.5, innerW: 84.5, gridfinity: 'baseplate' }],
  ['200×140 tapa mínima', { innerL: 200, innerW: 140, baseDepth: 45, lidMin: true }],
]) run(`apilable ${name}`, { ...p, stackable: true }, { bridges: true, stack: true });

console.log(`\n${fails ? '✘' : '✔'} ${checks} comprobaciones, ${fails} fallos`);
process.exit(fails ? 1 : 0);
