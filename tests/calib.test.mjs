/**
 * Pruebas del test de holguras (Node):
 *   node tests/calib.test.mjs
 *
 * 1. Universal: siempre las 8 probetas (A, P3, P5, F, B, C, d, E), sea cual
 *    sea la caja abierta. "Esta caja": solo las uniones que usa, con su valor
 *    central igual a la cota real de la caja.
 * 2. Cada probeta en la orientación de impresión de su unión: agujeros de A/P
 *    horizontales, F inclinado 45°, B vertical, d con el contacto en la cama,
 *    E boca abajo (retén = puente).
 * 3. Imprimibles y razonables: malla válida, un sólido, en z = 0, caben en
 *    la cama, sin voladizos > 50° (los techos planos son puentes cortos),
 *    universal < 30 g.
 * 4. applyResults: centro = sin cambios; fuera de rango pide repetir; B y F
 *    conservan el diámetro medido aunque A cambie; P desplaza Ø3/Ø5; d manda
 *    sobre la deducida de C; E "ninguno cierra" baja la precarga.
 * 5. Motor: tiltAdd solo afecta a cajas que se imprimen inclinadas; Ø3/Ø5 se
 *    interpolan; la precarga calibrada llega al cierre.
 * 6. Perfiles persistentes.
 */
import Module from 'manifold-3d';
import { init, build } from '../src/engine/engine.js';
import { calibPlan, buildCalibration, applyResults, CAL_KEYS, CAL_LIMITS } from '../src/engine/calib.js';
import { DEFAULTS, derive } from '../src/engine/params.js';

await init(Module);
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✔' : '  ✘'} ${msg}`); if (!ok) fails++; };
const ids = (plan) => plan.tests.map((t) => t.id).join(' ');

function overhangs(r) {
  // Caras que miran hacia abajo más de 50° fuera de la cama. Los techos
  // horizontales (puentes: canal del apilado, retén del cierre) se cuentan
  // aparte: son puentes cortos como los de la propia caja.
  let steep = 0, flat = 0;
  for (const q of r.parts.filter((x) => !x.id.endsWith('pin'))) {
    const v = q.mesh.vert, n = q.mesh.numProp, t = q.mesh.tri;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz); if (!l) continue;
      if (Math.min(v[a + 2], v[b + 2], v[c + 2]) <= 0.05) continue;
      const cz = nz / l;
      if (cz < -0.999) flat += l / 2;
      else if (cz < -Math.sin((50 * Math.PI) / 180) - 1e-3) steep += l / 2;
    }
  }
  return { steep, flat };
}

/* 1–3 --------------------------------------------------------------- */
const configs = [
  ['S filamento', { innerL: 60, innerW: 40, baseDepth: 21, lidDepth: 9 }, 'A B C E'],
  ['M impresos', {}, 'P B C E'],
  ['L inclinada + apilable', { innerL: 210, innerW: 160, stackable: true }, 'P F B C d E'],
  ['XS', { innerL: 20, innerW: 20, baseDepth: 15, lidDepth: 5 }, 'A B C E'],
  ['M filamento forzado + laberinto', { pinMode: 'filament', sealMode: 'labyrinth' }, 'A B C E'],
  ['S impresos + apilable', { innerL: 60, innerW: 40, pinMode: 'printed', stackable: true }, 'P B C d E'],
  ['capa 0.12 / línea 0.4 + octógono', { layerH: 0.12, lineWidth: 0.4, cornerCut: 15 }, 'P B C E'],
];
const universalIds = 'A P3 P5 F B C d E';
let uniDone = false;
for (const [name, p, expect] of configs) {
  console.log(`\n${name}`);
  const P = { ...DEFAULTS, ...p };
  const D = derive(P);
  const uni = calibPlan(P, { mode: 'universal' });
  check(ids(uni) === universalIds, `universal: ${ids(uni)} (independiente de la caja)`);
  const plan = calibPlan(P, { mode: 'box' });
  check(ids(plan) === expect, `esta caja: ${ids(plan)}`);
  for (const t of plan.tests) {
    const vs = t.variants.map((v) => v.value);
    const st = t.stepE || plan.step;
    const ok = vs.every((v, i) => i === 0 || Math.abs(v - vs[i - 1] - st) < 1e-6) && vs[0] >= CAL_LIMITS[t.key][0] - 1e-9;
    const mid = t.variants[Math.floor(t.variants.length / 2)];
    let real = '';
    if (t.id === 'A') real = Math.abs(mid.d - (D.pinMode === 'filament' ? D.holeD : 1.75 + 2 * D.filClr)) < 0.011 ? 'agujero de la caja' : '✘';
    if (t.id === 'P') real = Math.abs(mid.d - (D.pinMode === 'printed' ? D.holeD : D.latchHoleD)) < 0.011 ? 'agujero de la caja' : '✘';
    if (t.id === 'B') real = Math.abs(mid.d - D.latchBoreD) < 0.011 ? 'barril del cierre' : '✘';
    if (t.id === 'C') real = Math.abs(mid.w - D.gw) < 0.011 && Math.abs(t.tw - D.tw) < 1e-6 ? 'ranura y lengüeta de la caja' : '✘';
    if (t.id === 'd') real = Math.abs(mid.value - D.sclr) < 1e-6 ? 'holgura de apilado' : '✘';
    if (t.id === 'E') real = Math.abs(mid.value - D.pre) < 1e-6 ? 'precarga de la caja' : '✘';
    check(ok && real !== '✘', `${t.id}: ${vs.join(' / ')}${real ? ' · central = ' + real : ''}`);
  }
  for (const [label, pl] of uniDone ? [['esta caja', plan]] : [['universal', uni], ['esta caja', plan]]) {
    const r = buildCalibration(P, pl);
    const bad = r.parts.filter((x) => x.status !== 'NoError' || x.components !== 1);
    check(!bad.length, `${label}: ${r.parts.length} piezas válidas de un solo sólido${bad.length ? ' — ' + bad.map((x) => x.name).join(', ') : ''}`);
    check(r.parts.every((x) => Math.abs(x.bbox.min[2]) < 1e-6) && r.info.size[0] <= P.bedX - 10 && r.info.size[1] <= P.bedY - 10,
      `${label}: en la cama (${r.info.size.join('×')} mm, ${r.info.height} mm de alto)`);
    const o = overhangs(r);
    check(o.steep < 1, `${label}: sin voladizos > 50° (${o.steep.toFixed(1)} mm²; techos-puente ${o.flat.toFixed(0)} mm²)`);
    check(r.info.grams < 30, `${label}: ≈ ${r.info.grams} g, ≈ ${r.info.minutes} min`);
    if (label === 'universal') {
      // Orientación: F con el agujero a 45°; E boca abajo; d con el contacto abajo.
      const F = r.parts.find((x) => x.id === 'calF'), E = r.parts.find((x) => x.id === 'calE');
      check(!!F && !!E && !!r.parts.find((x) => x.id === 'calDb'), 'piezas F (inclinada), E (útil boca abajo) y d presentes');
    }
  }
  uniDone = true;
}

/* 4 ----------------------------------------------------------------- */
console.log('\nAplicación de resultados');
{
  const P = { ...DEFAULTS };
  const cur = Object.fromEntries(CAL_KEYS.map((k) => [k, P[k]]));
  const plan = calibPlan(P, { mode: 'universal' });
  const centre = Object.fromEntries(plan.tests.map((t) => [t.id, Math.floor(t.variants.length / 2) + 1]));
  const same = applyResults(plan, centre, cur);
  check(!same.changes.length && !same.retest, 'elegir la central de todas no cambia nada');
  const t1 = applyResults(plan, { A: 'tight' }, cur);
  check(t1.retest && t1.values.filClr > plan.tests[0].variants[4].value, `"todas duras" sale por arriba (${t1.values.filClr}) y pide repetir`);
  const e1 = applyResults(plan, { E: 'tight' }, cur);
  check(e1.retest && e1.values.latchPre < plan.tests.find((t) => t.id === 'E').variants[0].value, `E "ninguno cierra" baja la precarga (${e1.values.latchPre})`);
  const ab = applyResults(plan, { A: 5, B: 1, F: 4 }, cur);
  const tB = plan.tests.find((t) => t.id === 'B'), tF = plan.tests.find((t) => t.id === 'F');
  const dB = tB.variants[0].d, dF = tF.variants[3].d;
  check(Math.abs(1.75 + 2 * ab.values.filClr + ab.values.holeComp - dB) < 1e-6 || ab.values.holeComp === 0,
    `B conserva el diámetro vertical medido (Ø${dB}) aunque A cambie la holgura`);
  check(Math.abs(1.75 + 2 * (ab.values.filClr + ab.values.tiltAdd) - dF) < 1e-6, `F conserva el diámetro inclinado medido (Ø${dF}) → tiltAdd ${ab.values.tiltAdd}`);
  const p35 = applyResults(plan, { P3: 1, P5: 5 }, cur);
  check(p35.values.clearance === plan.tests.find((t) => t.id === 'P3').variants[0].value && p35.values.clearanceL === plan.tests.find((t) => t.id === 'P5').variants[4].value,
    `P3 y P5 fijan Ø3 (${p35.values.clearance}) y Ø5 (${p35.values.clearanceL})`);
  const cd = applyResults(plan, { C: 5, d: 1 }, cur);
  check(cd.values.stackClr === plan.tests.find((t) => t.id === 'd').variants[0].value, `d manda sobre la deducida de C (apilado ${cd.values.stackClr})`);
  const c = applyResults(plan, { C: 3 }, cur);
  check(['axialGap', 'stackClr', 'insertTol', 'pocketTol'].every((k) => Math.abs(c.values[k] - DEFAULTS[k]) < 1e-6), 'las deducidas de C reproducen los valores por defecto');
  // Modo "esta caja" (M, pasador Ø3.5): un solo diámetro → desplaza Ø3 y Ø5.
  const boxPlan = calibPlan(P, { mode: 'box' });
  const tP = boxPlan.tests.find((t) => t.id === 'P');
  const pb = applyResults(boxPlan, { P: 5 }, { ...cur, clearanceL: 0.35 });
  const a = pb.values.clearance, b = pb.values.clearanceL;
  const at = a + (b - a) * Math.min(1, Math.max(0, (tP.pinD - 3) / 2));
  check(Math.abs(at - tP.variants[4].value) < 1e-6 && Math.abs(b - a - 0.1) < 1e-6, `P (Ø${tP.pinD}) desplaza Ø3/Ø5 manteniendo la pendiente (${a} / ${b})`);
  const P2 = { ...P, ...c.values };
  check(Math.abs(calibPlan(P2, { fine: true }).tests.find((t) => t.id === 'C').variants[2].value - c.values.sealClr) < 1e-6, 'el test siguiente se centra en lo medido');
}

/* 5 ----------------------------------------------------------------- */
console.log('\nMotor');
{
  const flat = build({ ...DEFAULTS, tiltAdd: 0.15, quality: 'draft' }, null).D;
  const flat0 = build({ ...DEFAULTS, tiltAdd: 0, quality: 'draft' }, null).D;
  check(!flat.tilted && flat.holeD === flat0.holeD, `caja plana: tiltAdd no cambia nada (Ø${flat.holeD})`);
  const big = { ...DEFAULTS, innerL: 210, innerW: 160, quality: 'draft' };
  const t1 = build({ ...big, tiltAdd: 0.15 }, null).D, t0 = build({ ...big, tiltAdd: 0 }, null).D;
  check(t1.tilted && Math.abs(t1.holeD - t0.holeD - 0.3) < 0.011 && Math.abs(t1.latchHoleD - t0.latchHoleD - 0.3) < 0.011,
    `caja inclinada: bisagra Ø${t0.holeD} → Ø${t1.holeD}, cierre Ø${t0.latchHoleD} → Ø${t1.latchHoleD}`);
  const Dm = derive({ ...DEFAULTS, clearance: 0.2, clearanceL: 0.3 });
  check(Math.abs(Dm.holeD - (3.5 + 2 * 0.225)) < 0.011 && Math.abs(Dm.latchHoleD - (3.0 + 2 * 0.2)) < 0.011,
    `Ø3.5 interpolado entre Ø3 y Ø5 (Ø${Dm.holeD}); Ø3 usa Ø3 (Ø${Dm.latchHoleD})`);
  const Dp = derive({ ...DEFAULTS, latchPre: 0.3 });
  check(Math.abs(Dp.zkt - Dp.zc - 0.3) < 1e-6, 'la precarga calibrada llega al gancho del cierre');
}

/* 6 ----------------------------------------------------------------- */
console.log('\nPerfiles');
{
  const mem = {};
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const prof = await import('../src/calibProfile.js');
  const st = prof.loadProfiles({ holeComp: 0.3, clearance: 0.25 });
  const p = prof.activeProfile(st);
  check(p.values.holeComp === 0.3 && p.src.holeComp === 'manual' && !p.src.clearance && p.values.latchPre === DEFAULTS.latchPre, 'migra valores antiguos y completa los nuevos');
  prof.setManual(st, 'sealClr', 0.35);
  const st2 = prof.loadProfiles({});
  check(prof.activeProfile(st2).values.sealClr === 0.35 && prof.activeProfile(st2).src.sealClr === 'manual', 'el cambio manual persiste');
  const plan = calibPlan({ ...DEFAULTS, ...prof.activeProfile(st2).values });
  const res = applyResults(plan, { P3: 4, C: 2, E: 1 }, prof.activeProfile(st2).values);
  prof.setFromTest(st2, res, plan, { P3: 4, C: 2, E: 1 });
  const q = prof.activeProfile(prof.loadProfiles({}));
  check(q.src.clearance === 'test' && q.src.latchPre === 'test' && q.src.axialGap === 'derived' && q.calibrated && q.history.length === 1,
    'el resultado del test persiste (medidos y deducidos) con su historial');
  const st3 = prof.loadProfiles({});
  prof.addProfile(st3, 'Mi impresora · PETG', prof.activeProfile(st3));
  check(Object.keys(st3.profiles).length === 2 && prof.activeProfile(st3).calibrated, 'perfil nuevo copiado del actual');
  prof.resetProfile(st3);
  check(prof.activeProfile(st3).values.clearance === DEFAULTS.clearance, 'restablecer vuelve a los valores por defecto');
}

/* Fuera de rango: test nuevo SOLO de esas probetas ------------------- */
console.log('\nRepetición parcial');
{
  const P0 = { ...DEFAULTS };
  const plan = calibPlan(P0);
  const res = applyResults(plan, { A: 'tight', C: 3, B: 'loose', E: 2 }, P0);
  check(res.retest && JSON.stringify(res.retestIds) === JSON.stringify(['A', 'B']), `fuera de rango: ${res.retestIds.join(', ')}`);
  const P1 = { ...P0, ...res.values };
  const again = calibPlan(P1, { only: res.retestIds });
  const tA = again.tests.find((t) => t.id === 'A');
  const lastA = plan.tests.find((t) => t.id === 'A').variants.at(-1).value;
  check(again.tests.map((t) => t.id).join(',') === 'A,B' && again.partial && /solo A, B/.test(again.summary),
    `el test nuevo solo lleva ${again.tests.map((t) => t.id).join(', ')} (${again.summary})`);
  check(tA.variants[Math.floor(tA.variants.length / 2)].value > lastA, `A se centra más allá de la más holgada (${lastA} → centro ${tA.variants[Math.floor(tA.variants.length / 2)].value})`);
  const partial = calibPlan({ ...P0, pinMode: 'printed' }, { mode: 'box', onlyKeys: ['clearance'] });
  check(partial.tests.length === 1 && partial.tests[0].key === 'clearance', `solo lo que falta: ${partial.tests.map((t) => t.id).join(', ')}`);
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
