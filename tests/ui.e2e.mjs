/**
 * Interfaz en un navegador real (Chromium con Playwright):
 *   npm run build && npm run test:ui
 *
 * Comprueba la guía de interfaz (docs/GUIA-INTERFAZ.md) sobre
 * dist/rugged-box.html, el archivo que usa la gente:
 *  1. Carga sin errores en claro y en oscuro.
 *  2. Revelación progresiva: cada ajuste aparece cuando aplica.
 *  3. Deshacer / rehacer (botones y teclado); restablecer se puede deshacer.
 *  4. Nunca un diálogo del navegador; las hojas propias se cierran con Esc y
 *     no dejan nada en el documento.
 *  5. Accesibilidad: todo control con nombre, foco que vuelve al control
 *     usado, objetivos táctiles de 44 px, movimiento reducido, sin
 *     desplazamiento horizontal en un móvil.
 *  6. Contenido en cualquier mitad: piezas esperadas en cada combinación.
 *  7. Fugas: tras muchos cambios, ni las geometrías del visor, ni los nodos
 *     del documento, ni la memoria de JS crecen.
 *
 * Si Playwright no está instalado, la prueba se omite (no falla): el resto
 * de la batería no lo necesita.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.log('Prueba de interfaz omitida: Playwright no está instalado (npm i -D playwright && npx playwright install chromium).');
  process.exit(0);
}
const file = fileURLToPath(new URL('../dist/rugged-box.html', import.meta.url));
if (!existsSync(file)) { console.log('Falta dist/rugged-box.html: ejecuta antes `npm run build`.'); process.exit(1); }
const url = 'file://' + file;

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✔' : '  ✘'} ${msg}`); if (!ok) fails++; };
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] });
const problems = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('excepción: ' + e.message));
  page.on('dialog', (d) => { problems.push(`diálogo del navegador (${d.type()}): ${d.message()}`); d.dismiss(); });
  await page.goto(url);
  await idle(page);
  return { ctx, page };
};
/** Espera a que el modelo completo esté al día. */
const idle = (page) => page.waitForFunction(() => document.querySelector('#status')?.classList.contains('ok') && document.querySelector('#busy')?.hidden, null, { timeout: 180000 });
const parts = (page) => page.evaluate(() => window.__rugged.state.result.parts.map((p) => `${p.id}${p.side === 'base' ? ':base' : ''}`));
const P = (page, k) => page.evaluate((key) => window.__rugged.state.P[key], k);
const visible = (page, label) => page.locator(`[aria-label^="${label}"]`).first().isVisible().catch(() => false);
const tab = (page, id) => page.click(`[data-tab="${id}"]`);
/** El diálogo se elimina en su evento `close` (asíncrono): se espera a que no quede ninguno. */
const noDialogs = (page) => page.waitForFunction(() => !document.querySelector('dialog'), null, { timeout: 2000 }).then(() => true, () => false);

/* 1. Carga -------------------------------------------------------- */
console.log('Carga');
for (const colorScheme of ['light', 'dark']) {
  const { ctx, page } = await open({ colorScheme });
  const st = await page.evaluate(() => ({ text: document.querySelector('#statusText').textContent, bg: getComputedStyle(document.body).backgroundColor, n: window.__rugged.state.result.parts.length }));
  check(st.n >= 5 && /Al día/.test(st.text), `${colorScheme === 'light' ? 'claro' : 'oscuro'}: caja lista (${st.n} piezas, «${st.text}», fondo ${st.bg})`);
  await ctx.close();
}

const { ctx, page } = await open();

/* 2. Revelación progresiva ---------------------------------------- */
console.log('\nSe enseña solo lo que aplica');
await tab(page, 'contenido');
check(!(await visible(page, 'Columnas')) && !(await visible(page, 'Traba')) && !(await visible(page, 'Diámetro del imán')), 'sin compartimentos no hay columnas, traba ni imanes');
await page.selectOption('select[aria-label="La tapa lleva"]', 'org');
check(await visible(page, 'Columnas') && await visible(page, 'Traba'), 'compartimentos en la tapa: aparecen sus ajustes y la traba');
check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'La tapa lleva', 'al repintar el panel, el foco vuelve al control usado');
await page.selectOption('select[aria-label="Traba"]', 'magnet');
check(await visible(page, 'Diámetro del imán') && await visible(page, 'Altura del imán'), 'traba magnética: aparecen diámetro y altura del imán');
await idle(page);
const pm = await page.evaluate(() => { const O = window.__rugged.state.result.D.org; return { latch: O.latch, n: O.magnets.length, d: O.magnet.d, h: O.magnet.h }; });
check(pm.latch === 'magnet' && pm.n >= 1 && pm.d === 6 && pm.h === 2, `la caja lleva ${pm.n} parejas de imanes de ${pm.d} × ${pm.h} mm`);
check(/imanes de disco/.test(await page.locator('#info').innerText()), 'el resumen dice cuántos imanes hacen falta');

/* 6. Cualquier combinación ---------------------------------------- */
console.log('\nContenido en cualquier mitad');
await page.selectOption('select[aria-label="La base lleva"]', 'org');
await idle(page);
let ids = await parts(page);
check(ids.includes('orgPanel') && ids.includes('orgPanel:base') && !ids.includes('insert'), `compartimentos en las dos mitades (${ids.join(', ')})`);
await page.selectOption('select[aria-label="La tapa lleva"]', 'blank');
await idle(page);
ids = await parts(page);
check(ids.includes('orgPanel:base') && ids.includes('insertLid') && !ids.includes('orgPanel'), 'compartimentos en la base + inserto en la tapa');
await page.selectOption('select[aria-label="La base lleva"]', 'blank');
await page.selectOption('select[aria-label="La tapa lleva"]', 'org');
await idle(page);
ids = await parts(page);
check(ids.includes('insert') && ids.includes('orgPanel') && !ids.includes('orgPanel:base'), 'inserto en la base + compartimentos en la tapa');
await tab(page, 'mecanica');
await page.selectOption('select[aria-label="Junta entre tapa y base"]', 'cord');
await idle(page);
ids = await parts(page);
check(!ids.includes('gasket') && /filamento TPU/.test(await page.locator('#info').innerText()), 'junta de cordón: sin pieza de junta y con la longitud a cortar en el resumen');

/* 3. Deshacer / rehacer ------------------------------------------- */
console.log('\nEl usuario manda');
check(await P(page, 'sealMode') === 'cord' && !(await page.isDisabled('#btnUndo')), 'hay historial tras los cambios');
await page.click('#btnUndo');
check(await P(page, 'sealMode') !== 'cord' && !(await page.isDisabled('#btnRedo')), 'Deshacer vuelve al sellado anterior');
await page.click('#btnRedo');
check(await P(page, 'sealMode') === 'cord', 'Rehacer lo recupera');
await page.locator('#viewport').click({ position: { x: 300, y: 300 } });
await page.keyboard.press('Control+z');
check(await P(page, 'sealMode') !== 'cord', 'Ctrl+Z deshace');
await page.keyboard.press('Control+Shift+z');
check(await P(page, 'sealMode') === 'cord', 'Ctrl+Mayús+Z rehace');
// Arrastrar un deslizador = un solo paso.
await tab(page, 'caja');
const before = await page.evaluate(() => window.__rugged.hist.undo.length);
for (const v of [130, 140, 150, 160]) await page.evaluate((x) => { const r = document.querySelector('input[type=range][aria-label="Largo"]'); r.value = x; r.dispatchEvent(new Event('input', { bubbles: true })); }, v);
check(await P(page, 'innerL') === 160 && (await page.evaluate(() => window.__rugged.hist.undo.length)) === before + 1, 'arrastrar un deslizador cuenta como un paso del historial');
await page.click('#btnUndo');
check(await P(page, 'innerL') === 120, 'y se deshace de una vez (160 → 120 mm)');
// Restablecer no pregunta y se puede deshacer.
await page.click('#btnReset');
check(await P(page, 'sealMode') === 'tpu' && await page.locator('.toast button').count() === 1, 'Restablecer actúa sin preguntar y ofrece «Deshacer»');
await page.click('.toast button');
check(await P(page, 'sealMode') === 'cord' && await P(page, 'lidMode') === 'org', 'deshacer el restablecimiento devuelve la caja');

/* 4. Hojas propias ------------------------------------------------- */
console.log('\nSin diálogos del navegador');
await tab(page, 'impresion');
await page.locator('button:has-text("Nuevo…")').click();
check(await page.locator('dialog.sheet[open]').count() === 1 && await page.evaluate(() => document.activeElement?.tagName) === 'INPUT', 'la hoja «Nuevo perfil» se abre con el foco en el nombre');
await page.keyboard.press('Escape');
check(await noDialogs(page), 'Esc la cierra y no queda en el documento');
await page.click('#btnStl');
await page.locator('dialog.sheet .list').waitFor({ timeout: 180000 });
const nRows = await page.locator('dialog.sheet .list > div').count();
await page.locator('dialog.sheet button:has-text("Hecho")').click();
check(nRows >= 5 && await noDialogs(page), `«STL por pieza»: ${nRows} piezas listadas; al cerrar no queda nada`);

/* 5. Accesibilidad ------------------------------------------------- */
console.log('\nPara todo el mundo');
for (const t of ['caja', 'contenido', 'tapa', 'mecanica', 'impresion']) {
  await tab(page, t);
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, select, input:not([type=file]), summary')].filter((e) => {
    if (e.closest('[hidden]')) return false;
    const name = e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent.trim() || e.closest('label')?.textContent.trim();
    return !name;
  }).map((e) => e.outerHTML.slice(0, 80)));
  check(!unnamed.length, `pestaña ${t}: todos los controles tienen nombre${unnamed.length ? ' — ' + unnamed.join(' | ') : ''}`);
}
await tab(page, 'caja');
await page.keyboard.press('Tab');
const ring = await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { tag: e.tagName, w: parseFloat(s.outlineWidth), style: s.outlineStyle }; });
check(ring.w >= 2 && ring.style !== 'none', `foco visible con teclado (${ring.tag}, anillo de ${ring.w} px)`);
check(await page.evaluate(() => document.querySelectorAll('input.switch[role=switch]').length >= 2 && !!document.querySelector('#status[role=status]')), 'interruptores con role="switch" y estado en vivo');
await page.click('label.tgl:has(#section)');
check(await page.isVisible('#sectionPos'), 'la posición del corte aparece solo con el corte activo');
await page.click('label.tgl:has(#section)');
check(!(await page.isVisible('#sectionPos')), 'y se oculta al quitarlo');
await ctx.close();

{
  // Móvil: dedo (objetivos de 44 px), sin desplazamiento horizontal.
  const { ctx: c2, page: p2 } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const m = await p2.evaluate(() => ({
    over: document.scrollingElement.scrollWidth - innerWidth,
    btn: Math.min(...[...document.querySelectorAll('.actions button')].map((b) => b.getBoundingClientRect().height)),
    sel: Math.min(...[...document.querySelectorAll('.seg button')].map((b) => b.getBoundingClientRect().height)),
    coarse: matchMedia('(pointer: coarse)').matches,
  }));
  check(m.over <= 0, `móvil de 390 px: sin desplazamiento horizontal (${m.over} px)`);
  check(!m.coarse || (m.btn >= 44 && m.sel >= 36), `con el dedo: botones de ${Math.round(m.btn)} px y segmentos de ${Math.round(m.sel)} px`);
  await c2.close();
  const { ctx: c3, page: p3 } = await open({ reducedMotion: 'reduce' });
  const dur = await p3.evaluate(() => parseFloat(getComputedStyle(document.querySelector('input.switch'), '::after').transitionDuration));
  check(dur < 0.01, `«reducir movimiento»: transiciones de ${dur * 1000} ms`);
  await c3.close();
}

/* 7. Fugas --------------------------------------------------------- */
console.log('\nFugas de memoria y rendimiento de la interfaz');
{
  const { ctx: c4, page: p4 } = await open();
  const cycle = async (i) => {
    await p4.evaluate((k) => {
      const R = window.__rugged;
      R.setParam('innerL', 110 + (k % 5) * 12);
      R.setParam('lidMode', ['off', 'org', 'blank'][k % 3]);
      R.setParam('insertMode', ['off', 'blank', 'org'][k % 3]);
      R.setParam('orgLatch', k % 2 ? 'magnet' : 'snap');
      R.viewer.setMode(['assembled', 'exploded', 'print'][k % 3]);
      R.viewer.setOpen((k % 4) / 3);
      R.toast('prueba ' + k);
    }, i);
    await idle(p4);
  };
  const measure = () => p4.evaluate(async () => {
    for (const t of [...document.querySelectorAll('.toast')]) t._close(true);
    window.gc?.(); await new Promise((r) => setTimeout(r, 150)); window.gc?.();
    return { ...window.__rugged.stats(), heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0 };
  });
  for (let i = 0; i < 6; i++) await cycle(i);           // calentamiento (cachés llenas)
  await cycle(0);                                       // se mide siempre en el MISMO estado
  const a = await measure();
  const t0 = Date.now();
  for (let i = 6; i < 30; i++) await cycle(i);
  const dt = (Date.now() - t0) / 24;
  await cycle(0);
  const b = await measure();
  check(b.geometries === a.geometries && b.textures === a.textures, `visor: ${a.geometries} → ${b.geometries} geometrías tras 24 reconstrucciones (mismo estado; texturas ${b.textures})`);
  check(b.nodes === a.nodes && b.dialogs === 0 && b.toasts === 0, `documento: ${a.nodes} → ${b.nodes} nodos, ${b.dialogs} diálogos, ${b.toasts} notificaciones`);
  check(b.undo <= 100, `historial acotado (${b.undo} pasos ≤ 100)`);
  check(!a.heap || b.heap - a.heap < 25, `memoria de JS: ${a.heap.toFixed(1)} → ${b.heap.toFixed(1)} MB (crece ${(b.heap - a.heap).toFixed(1)} MB < 25)`);
  console.log(`    (${Math.round(dt)} ms por cambio completo, con modelo afinado, en esta máquina)`);
  // La interfaz responde mientras se calcula: el clic no espera al motor.
  const lag = await p4.evaluate(async () => {
    window.__rugged.setParam('innerL', 171);
    const t = performance.now();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t;
  });
  check(lag < 250, `la interfaz no se bloquea al cambiar un ajuste (2 fotogramas en ${Math.round(lag)} ms)`);
  await idle(p4);
  await c4.close();
}

check(!problems.length, `sin errores de consola ni diálogos del navegador${problems.length ? ' — ' + [...new Set(problems)].slice(0, 4).join(' | ') : ''}`);
await browser.close();
console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
