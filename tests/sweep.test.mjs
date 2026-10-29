/**
 * Barrido de regresión en TODA la gama de tamaños (de 20 mm a 380 mm).
 *
 *   node tests/sweep.test.mjs                 # barrido completo
 *   node tests/sweep.test.mjs --quick         # 6 configuraciones representativas
 *   node tests/sweep.test.mjs --chunk=1/3     # trocea el barrido (máquinas lentas)
 *   node tests/sweep.test.mjs --filter=apil   # solo casos cuyo nombre contenga…
 *
 * Por cada configuración comprueba:
 *   1. Todas las piezas: malla válida y UN solo sólido (sin trozos sueltos).
 *   2. Mecánica mínima (nudillo ≥ 4 mm, cierre ≥ 6 mm).
 *   3. Caja cerrada sin interferencias; apertura 0–180° sin choques.
 *   4. Cierres: sin choque con la base al girar 0–80°.
 *   5. Inclinada: la mecánica conserva el 100 % de su volumen tras el bisel y
 *      no quedan voladizos sin soporte (contando aletas y soportes).
 *   6. Apilable: asienta sin interferencia y bloquea desplazamientos de 0.6 mm.
 *   7. Insertos: encajan sin interferencia y no invaden el contenido.
 *   8. Montaje real: pasadores y tapones no se solapan con la caja y se pueden
 *      colocar (camino libre); el filamento entra recto.
 *  10. Mecánica completa en base y tapa (nada la recorta).
 *  12. Agujeros de cierre y tapones con holgura, compensación y chaflán.
 *  11. Espesor mínimo de 2 líneas (sin membranas que se transparenten).
 *   9. Sin soportes: en las piezas planas ningún puente > puente máximo (10 mm).
 * Escribe el detalle en logs/sweep-<fecha>.log y un resumen en logs/sweep-latest.json.
 */
import Module from 'manifold-3d';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { init, build, _internal } from '../src/engine/engine.js';
import { DEFAULTS, derive } from '../src/engine/params.js';
import { M, CS } from '../src/engine/geo.js';
import { overhangRegions } from '../src/engine/tilt.js';
import { pack } from '../src/packer.js';
import { pinChecks, bridgeChecks, mechChecks, thicknessChecks, printFitChecks } from './lib/assembly.mjs';

await init(Module);
const { hinges, latches, buildBase, buildLid } = _internal;

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
mkdirSync('logs', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logFile = `logs/sweep-${stamp}.log`;
writeFileSync(logFile, `Rugged Box — barrido ${new Date().toISOString()}\n`);
const say = (s) => { console.log(s); appendFileSync(logFile, s + '\n'); };

/* ---------- Casos ---------- */
const SIZES = [
  [20, 20, 10, 4], [30, 25, 15, 5], [45, 30, 18, 6], [60, 40, 21, 9], [90, 60, 30, 10],
  [120, 80, 35, 15], [160, 100, 40, 15], [200, 140, 45, 15], [250, 170, 30, 10],
  [300, 200, 28, 12], [380, 260, 60, 20],
];
// Contenido sintético: elipse alargada al 70 % del interior.
const ellipse = (L, W) => Array.from({ length: 48 }, (_, i) => {
  const a = (i / 48) * 2 * Math.PI; return [0.35 * L * Math.cos(a), 0.3 * W * Math.sin(a)];
});
const VARIANTS = [
  ['octógono', (L, W) => ({ cornerCut: Math.round(0.2 * Math.min(L, W)) })],
  ['apilable', () => ({ stackable: true })],
  ['gridfinity interior', () => ({ gridfinity: 'baseplate' })],
  ['laberinto + tapa mínima', () => ({ sealMode: 'labyrinth', lidMin: true })],
  ['inserto en blanco + tapa', () => ({ insertMode: 'blank', insertLid: true })],
  ['inserto con alojamiento', (L, W) => ({ insertMode: 'pockets', contentPolys: [ellipse(L, W)] })],
  ['radial + relieve', () => ({ pattern: 'radial', relief: 'emboss' })],
];
let cases = [];
SIZES.forEach(([L, W, bd, ld], i) => {
  const base = { innerL: L, innerW: W, baseDepth: bd, lidDepth: ld };
  cases.push({ name: `${L}×${W} estándar`, p: base });
  const [vn, vf] = VARIANTS[i % VARIANTS.length];
  cases.push({ name: `${L}×${W} ${vn}`, p: { ...base, ...vf(L, W) } });
});
// Varios objetos acomodados automáticamente (como en la interfaz).
{
  const wr = (L, hw) => { const p = []; for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + (i / 16) * Math.PI; p.push([hw * 1.6 * Math.cos(a), hw * 1.6 * Math.sin(a)]); } p.push([L - 12, -hw * 0.55], [L, -hw * 0.9], [L, hw * 0.9], [L - 12, hw * 0.55]); return p; };
  const objs = [{ polys: [wr(140, 9)], qty: 2 }, { polys: [wr(90, 7)], qty: 1 }, { polys: [ellipse(60, 60)], qty: 1 }];
  const opt = { spacing: 3, pocketTol: 0.6, fingerCount: 'auto', fingerD: 20, fingerPos: 0, rotate: true };
  const k = pack(objs, opt);
  const m = 0.3 + 0.9 + 0.8 + 1;
  cases.push({ name: 'varios objetos acomodados', p: { innerL: Math.ceil(k.w + 2 * m), innerW: Math.ceil(k.h + 2 * m), baseDepth: 30, lidDepth: 10,
    insertMode: 'pockets', contentObjects: k.placed.map((q) => ({ polys: q.polys, notches: q.notches })) } });
}
// Casos girados (ancho > largo) y del barrido rápido.
cases.push({ name: '25×120 girada', p: { innerL: 25, innerW: 120, baseDepth: 20, lidDepth: 5 } });
// Pasadores forzados (montaje real) y apilado en más formas.
cases.push({ name: '45×30 pasadores impresos', p: { innerL: 45, innerW: 30, baseDepth: 18, lidDepth: 6, pinMode: 'printed' } });
cases.push({ name: '160×100 filamento + laberinto', p: { innerL: 160, innerW: 100, baseDepth: 40, lidDepth: 15, pinMode: 'filament', sealMode: 'labyrinth' } });
cases.push({ name: '320×220 impresos (3 bisagras)', p: { innerL: 320, innerW: 220, baseDepth: 40, lidDepth: 15, pinMode: 'printed' } });
cases.push({ name: '120×80 apilable + octógono', p: { stackable: true, cornerCut: 18 } });
// Clase XS (ultrapequeña): toda la combinatoria que rompía la mecánica.
for (const [L, W, bd, ld] of [[20, 20, 5, 15], [25, 18, 8, 3], [35, 30, 12, 5]]) {
  for (const [vn, v] of [['', {}], [' apilable + tapa mínima', { stackable: true, lidMin: true }], [' laberinto + impresos', { sealMode: 'labyrinth', pinMode: 'printed' }]])
    cases.push({ name: `XS ${L}×${W}×${bd}${vn}`, p: { innerL: L, innerW: W, baseDepth: bd, lidDepth: ld, ...v } });
}
cases.push({ name: 'XS 20×40 girada + octógono', p: { innerL: 20, innerW: 40, baseDepth: 10, lidDepth: 4, cornerCut: 4 } });
cases.push({ name: 'XS forzada en 60×40', p: { innerL: 60, innerW: 40, baseDepth: 15, lidDepth: 5, sizeClass: 'XS' } });
cases.push({ name: '60×40 apilable + filamento', p: { innerL: 60, innerW: 40, baseDepth: 21, lidDepth: 9, stackable: true } });
// Perfiles de calibración en los extremos que puede dar el test de holguras:
// toda la mecánica debe seguir montando y abriendo con ellos.
const LOOSE = { filClr: 0.25, clearance: 0.4, clearanceL: 0.45, tiltAdd: 0.2, holeComp: 0.35, sealClr: 0.45, axialGap: 0.6, stackClr: 0.5, latchPre: 0.05, insertTol: 0.5, pocketTol: 0.8 };
const TIGHT = { filClr: 0.05, clearance: 0.1, clearanceL: 0.1, tiltAdd: -0.05, holeComp: 0, sealClr: 0.1, axialGap: 0.25, stackClr: 0.15, latchPre: 0.3, insertTol: 0.15, pocketTol: 0.45 };
cases.push({ name: 'perfil holgado M apilable + laberinto', p: { stackable: true, sealMode: 'labyrinth', ...LOOSE } });
cases.push({ name: 'perfil holgado S filamento', p: { innerL: 60, innerW: 40, baseDepth: 21, lidDepth: 9, ...LOOSE } });
cases.push({ name: 'perfil justo M impresos + inserto', p: { pinMode: 'printed', insertMode: 'blank', ...TIGHT } });
cases.push({ name: 'perfil justo XS', p: { innerL: 25, innerW: 25, baseDepth: 12, lidDepth: 5, ...TIGHT } });
cases.push({ name: 'perfil holgado L inclinada', p: { innerL: 210, innerW: 160, baseDepth: 40, lidDepth: 15, ...LOOSE } });
cases.push({ name: 'perfil justo L inclinada', p: { innerL: 230, innerW: 150, baseDepth: 40, lidDepth: 15, ...TIGHT } });
// Organizador en la tapa: toda la mecánica de la caja debe seguir intacta.
cases.push({ name: 'organizador herramienta 6×3 una tapa', p: { innerL: 205, innerW: 100, baseDepth: 30, lidOrg: true, orgCols: 6, orgRows: 3, orgMinL: 33, orgMinW: 32, orgDepth: 26 } });
cases.push({ name: 'organizador S 3×2 por celda', p: { innerL: 60, innerW: 40, baseDepth: 21, lidDepth: 12, lidOrg: true, orgCols: 3, orgRows: 2, orgCover: 'cell' } });
cases.push({ name: 'organizador apilable octógono por fila', p: { innerL: 160, innerW: 90, cornerCut: 15, stackable: true, lidOrg: true, orgCols: 5, orgRows: 3, orgCover: 'row' } });
if (args.quick) cases = cases.filter((c) => /^(20×20|60×40|120×80|250×170|380×260) estándar|apilable|alojamiento|varios|impresos \(|^XS 20×20×5/.test(c.name)).slice(0, 12);
if (args.filter) cases = cases.filter((c) => c.name.includes(args.filter));
if (args.chunk) {
  const [k, n] = String(args.chunk).split('/').map(Number);
  const per = Math.ceil(cases.length / n);
  cases = cases.slice((k - 1) * per, k * per);
}

/* ---------- Utilidades ---------- */
const toMan = (mesh, mat) => { const m = new (M())({ numProp: mesh.numProp, vertProperties: mesh.vert, triVerts: mesh.tri }); return mat ? m.transform(mat) : m; };
const rotX = (man, deg, y, z) => man.translate([0, -y, -z]).rotate([deg, 0, 0]).translate([0, y, z]);
let fails = 0, checks = 0;
const summary = [];

for (const c of cases) {
  const P = { ...DEFAULTS, ...c.p };
  const res = { name: c.name, fails: [], ms: 0 };
  const check = (ok, msg) => { checks++; if (!ok) { fails++; res.fails.push(msg); } appendFileSync(logFile, `   ${ok ? '✔' : '✘'} ${msg}\n`); };
  say(`\n▶ ${c.name}`);
  let r;
  try {
    const t0 = performance.now();
    r = build(P, null, { normals: false });
    res.ms = Math.round(performance.now() - t0);
  } catch (e) {
    check(false, `build lanzó: ${String(e).slice(0, 200)}`);
    summary.push(res); continue;
  }
  appendFileSync(logFile, r.D.log.map((l) => '   · ' + l).join('\n') + '\n');
  if (r.D.warn.length) appendFileSync(logFile, `   avisos: ${r.D.warn.join(' | ')}\n`);
  // Los tramos centrales de una junta dividida son dos tiras rectas (una por lado).
  for (const p of r.parts) check(p.status === 'NoError' && p.components <= (p.id === 'gasket' ? 2 : 1), `${p.name}: ${p.status}, ${p.components} sólido(s)`);
  check(r.D.hinge.kl >= 4 && r.D.latchW >= 6, `mecánica mínima: nudillo ${r.D.hinge.kl}, cierre ${r.D.latchW}`);

  // Mismas cotas que usó el motor (si predijo impresión inclinada, con tiltAdd).
  const D = derive(r.D.tilted ? { ...P, _tilted: true } : P);
  const H = hinges(D), L = latches(D);
  const base = buildBase(D, H, L, []);
  const lid = buildLid(D, P, H, L, null, []).lid;
  const vClosed = base.intersect(lid).volume();
  check(vClosed < 0.05, `cerrada: ${vClosed.toFixed(3)} mm³`);
  let worst = 0;
  for (let a = 15; a <= 180; a += 15) worst = Math.max(worst, base.intersect(rotX(lid, -a, D.ya, D.za)).volume());
  check(worst < 0.05, `apertura 0–180°: ${worst.toFixed(3)} mm³`);
  let wl = 0;
  for (const x of D.latch.xs) for (let a = 0; a <= 80; a += 20) wl = Math.max(wl, rotX(L.latch.translate([x, 0, 0]), a, D.yp, D.zp).intersect(base).volume());
  check(wl < 0.05, `cierres 0–80°: ${wl.toFixed(3)} mm³`);

  // Inclinada: mecánica intacta + voladizos cubiertos.
  const spans = [...D.hinge.xs.map((x) => [x, D.hinge.len / 2]), ...D.latch.xs.map((x) => [x, D.latch.span / 2])];
  const zone = M().union(spans.map(([x, h]) => M().cube([2 * h, 1000, 1000]).translate([x - h, -500, -500])))
    .subtract(M().cube([1000, D.Wo + 2 * D.bo + 0.2, 1000], true));
  for (const [id, ref] of [['base', base], ['lid', lid]]) {
    const pt = r.parts.find((q) => q.id === id);
    if (!pt.tilt) continue;
    const m = toMan(pt.mesh);
    const a = ref.intersect(zone).volume(), b = m.intersect(zone).volume();
    check(a - b <= Math.max(1, 0.01 * a), `${pt.name} inclinada ${pt.tilt.alpha}°: mecánica conservada (${b.toFixed(0)}/${a.toFixed(0)} mm³)`);
    const R = toMan(pt.mesh, pt.print);
    const helpers = pt.aids.map((x) => toMan(x.mesh));
    const helper = helpers.length ? M().union(helpers) : null;
    const left = overhangRegions(R, helper, { angle: 52, step: 0.6, minArea: 4 });
    const area = left.reduce((s, x) => s + x.area, 0);
    check(area < 20, `${pt.name}: voladizo sin soporte restante ${area.toFixed(0)} mm²`);
  }

  // Apilable.
  if (D.stack) {
    const zTop = D.Hb + D.Hl;
    const v0 = base.translate([0, 0, zTop]).intersect(lid).volume();
    const vx = base.translate([0.6, 0, zTop]).intersect(lid).volume();
    const vy = base.translate([0, 0.6, zTop]).intersect(lid).volume();
    check(v0 < 0.05 && vx > 1 && vy > 1, `apilado: asienta (${v0.toFixed(2)}) y bloquea X (${vx.toFixed(0)}) e Y (${vy.toFixed(0)})`);
  }

  // Insertos.
  for (const id of ['insert', 'insertLid']) {
    const pt = r.parts.find((q) => q.id === id);
    if (!pt) continue;
    const m = toMan(pt.mesh);
    const v = m.intersect(id === 'insert' ? base : lid).volume();
    check(v < 0.05, `${pt.name}: encaja sin interferencia (${v.toFixed(3)} mm³)`);
    const cps = P.contentObjects ? P.contentObjects.flatMap((o) => o.polys) : P.contentPolys;
    if (id === 'insert' && cps) {
      const obj = M().union(cps.map((p) => CS().ofPolygons([p], 'EvenOdd').extrude(D.Db - 1).translate([0, 0, D.floorTop + 0.5])));
      const vo = m.intersect(obj).volume();
      check(vo < 0.05, `${pt.name}: el contenido cabe en su alojamiento (${vo.toFixed(3)} mm³)`);
    }
  }
  // Montaje real de pasadores y tapones + impresión plana sin soportes.
  for (const x of mechChecks(D, H, L, base, lid)) check(x.ok, x.msg);
  for (const x of thicknessChecks(D, base, lid)) check(x.ok, x.msg);
  for (const x of pinChecks(r, D, base, lid)) check(x.ok, x.msg);
  for (const x of printFitChecks(r, D)) check(x.ok, x.msg);
  for (const x of bridgeChecks(r, r.D.maxBridge)) check(x.ok, x.msg);
  say(`  ${res.fails.length ? '✘ ' + res.fails.join(' | ') : '✔ correcto'} (${res.ms} ms)`);
  summary.push(res);
  _internal.cleanup();
}

const out = { fecha: new Date().toISOString(), casos: summary.length, comprobaciones: checks, fallos: fails, detalle: summary };
writeFileSync('logs/sweep-latest.json', JSON.stringify(out, null, 2));
say(`\n${fails ? '✘' : '✔'} ${summary.length} casos, ${checks} comprobaciones, ${fails} fallos — registro: ${logFile}`);
process.exit(fails ? 1 : 0);
