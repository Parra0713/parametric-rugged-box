/**
 * Guía de interfaz (docs/GUIA-INTERFAZ.md): lo que se puede medir sin
 * navegador (Node):
 *   node tests/ui-guide.test.mjs
 *
 *  1. Contraste AA (≥ 4,5:1) de cada pareja texto/fondo, en claro y oscuro.
 *  2. Hoja de estilos: sin mayúsculas forzadas, con foco visible, movimiento
 *     reducido, modo oscuro, objetivos táctiles y solo variables de color.
 *  3. Código de la interfaz: sin alert/confirm/prompt del navegador; lo que
 *     se crea se libera (diálogos, notificaciones, URLs de descarga).
 *  4. Esquema: textos en frase normal, sin jerga del motor, cada ajuste con
 *     valor por defecto y `when` válido (revelación progresiva coherente).
 *  5. HTML: idioma, nombres accesibles y regiones vivas.
 */
import { readFileSync } from 'node:fs';
import { DEFAULTS, SCHEMA, TABS, VERSION, contentModes, migrate } from '../src/engine/params.js';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✔' : '  ✘'} ${msg}`); if (!ok) fails++; };
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const viewerJs = readFileSync(new URL('../src/viewer.js', import.meta.url), 'utf8');
const exportJs = readFileSync(new URL('../src/export.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/* 1. Contraste ------------------------------------------------------ */
console.log('Contraste (WCAG AA)');
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokensOf = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = tokensOf(noComments.match(/:root\s*\{([\s\S]*?)\}/)[1]);
const dark = { ...light, ...tokensOf(noComments.match(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)[1]) };
const parse = (c) => {
  if (c.startsWith('#')) { const h = c.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1); }
  const m = c.match(/rgba?\(([^)]+)\)/);
  const v = m[1].split(',').map((x) => Number(x.trim()));
  return [v[0], v[1], v[2], v[3] ?? 1];
};
const over = (fg, bg) => { const [r, g, b, a] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a), 1]; };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
for (const [name, T] of [['claro', light], ['oscuro', dark]]) {
  const bg = parse(T['--bg']), surface = parse(T['--surface']);
  const fill = over(parse(T['--fill']), bg);
  const pairs = [
    ['texto / fondo', T['--text'], bg], ['texto / superficie', T['--text'], surface], ['texto / control', T['--text'], fill],
    ['secundario / fondo', T['--text-2'], bg], ['secundario / superficie', T['--text-2'], surface], ['secundario / control', T['--text-2'], fill],
    ['acento / fondo', T['--accent'], bg], ['acento / superficie', T['--accent'], surface],
    ['texto del botón principal', T['--on-accent'], parse(T['--accent-fill'])],
    ['correcto / su fondo', T['--ok'], over(parse(T['--ok-bg']), bg)],
    ['aviso / su fondo', T['--warn'], over(parse(T['--warn-bg']), bg)],
    ['error / fondo', T['--err'], bg], ['error / superficie', T['--err'], surface],
    ['texto / aviso', T['--text'], over(parse(T['--warn-bg']), bg)],
  ];
  const bad = pairs.map(([n, fg, b]) => [n, ratio(parse(fg), b)]).filter(([, r]) => r < 4.5);
  const worst = Math.min(...pairs.map(([, fg, b]) => ratio(parse(fg), b)));
  check(!bad.length, `${name}: ${pairs.length} parejas ≥ 4,5:1 (la peor ${worst.toFixed(2)}:1)${bad.length ? ' — ' + bad.map(([n, r]) => `${n} ${r.toFixed(2)}`).join(', ') : ''}`);
  // Lo no textual (interruptor, pista, anillo de foco): ≥ 3:1.
  check(ratio(parse(T['--accent-fill']), bg) >= 3, `${name}: el relleno de acento se distingue del fondo (${ratio(parse(T['--accent-fill']), bg).toFixed(2)}:1 ≥ 3)`);
}

/* 2. Hoja de estilos ------------------------------------------------ */
console.log('\nHoja de estilos');
check(!/text-transform\s*:\s*uppercase/.test(noComments), 'sin mayúsculas forzadas (text-transform: uppercase)');
check(!/letter-spacing\s*:\s*0\.[1-9]/.test(noComments), 'sin interletrado de rótulo');
check(/:focus-visible/.test(css) && /prefers-reduced-motion:\s*reduce/.test(css) && /prefers-color-scheme:\s*dark/.test(css)
  && /pointer:\s*coarse/.test(css) && /prefers-contrast:\s*more/.test(css), 'foco visible, movimiento reducido, oscuro, táctil y más contraste');
check(/min-height:\s*44px/.test(css), 'objetivos táctiles de 44 px');
{
  // Fuera de :root no se escriben colores sueltos (salvo sombras y el
  // gris del segmento seleccionado en oscuro, que no son tema).
  const body = noComments.replace(/:root\s*\{[\s\S]*?\}/g, '').replace(/url\("data:[^"]*"\)/g, '');
  const stray = [...body.matchAll(/^[^\n]*#[0-9a-fA-F]{3,8}\b[^\n]*$/gm)].map((m) => m[0].trim()).filter((l) => !/\.seg button\.on/.test(l));
  check(!stray.length, `colores solo como variables${stray.length ? ' — ' + stray.slice(0, 3).join(' | ') : ''}`);
}
check(/font-variant-numeric:\s*tabular-nums/.test(css) && /-apple-system/.test(light['--font']) && /Segoe UI/.test(light['--font']), 'tipografía del sistema con cifras tabulares');
{
  // Duraciones de todas las transiciones y animaciones (salvo el giro del
  // indicador de cálculo, que es continuo): entre 150 y 250 ms.
  const ms = [...noComments.matchAll(/(?:transition|animation)[\w-]*\s*:([^;]*);/g)].filter((m) => !/spin/.test(m[1]) && !/!important/.test(m[1]))
    .flatMap((m) => [...m[1].matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)].map((d) => Number(d[1]) * (d[2] === 's' ? 1000 : 1)));
  check(ms.length >= 6 && ms.every((v) => v >= 150 && v <= 250), `movimiento breve: ${ms.length} duraciones entre ${Math.min(...ms)} y ${Math.max(...ms)} ms (150–250)`);
}

/* 3. Código de la interfaz ------------------------------------------ */
console.log('\nCódigo de la interfaz');
{
  const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const calls = [...code.matchAll(/(^|[^\w.$])(alert|confirm|prompt)\s*\(/g)].length;
  check(calls === 0, `sin alert / confirm / prompt del navegador (${calls})`);
  check(/dlg\.addEventListener\('close'[\s\S]{0,80}dlg\.remove\(\)/.test(code), 'los diálogos se eliminan al cerrarse');
  check(/clearTimeout\(timer\)/.test(code) && /box\.children\.length >= 3/.test(code), 'las notificaciones limpian su temporizador y tienen tope');
  check(/HIST_MAX/.test(code) && /hist\.undo\.shift\(\)/.test(code), 'el historial de deshacer tiene tope');
  check(/revokeObjectURL/.test(exportJs), 'las descargas liberan su URL (revokeObjectURL)');
  check(/\.dispose\(\)/.test(viewerJs) && /clearRoot\(\)/.test(viewerJs), 'el visor libera geometrías y materiales');
  check(/remember\(/.test(code) && /function undo\(\)/.test(code) && /function redo\(\)/.test(code) && /metaKey/.test(code), 'deshacer / rehacer con teclado');
  check(/when\(state\.P\)/.test(code) && /visSig\(\)/.test(code), 'revelación progresiva: el panel se repinta cuando cambia lo que aplica');
  check(code.includes('VERSION') && VERSION === pkg.version, `una sola versión (${VERSION}) en la interfaz y en package.json`);
}

/* 4. Esquema -------------------------------------------------------- */
console.log('\nTextos y ajustes del esquema');
{
  const items = SCHEMA.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
  const texts = [...TABS.flatMap((t) => [t[1], t[2]]), ...SCHEMA.map((g) => g.group), ...items.map((i) => i.label), ...items.filter((i) => i.hint).map((i) => i.hint),
    ...items.filter((i) => i.options).flatMap((i) => i.options.map((o) => o[1]))];
  const shout = texts.filter((t) => /\b[A-ZÁÉÍÓÚÑ]{4,}\b/.test(t.replace(/\b(TPU|PETG|PLA|ASA|STL|SVG|FDM)\b/g, '')));
  check(!shout.length, `sin MAYÚSCULAS en los textos${shout.length ? ' — ' + shout.join(' | ') : ''}`);
  const lower = texts.filter((t) => /^[a-záéíóúñ]/.test(t));
  check(!lower.length, `todo empieza con mayúscula${lower.length ? ' — ' + lower.join(' | ') : ''}`);
  const dot = [...SCHEMA.map((g) => g.group), ...items.map((i) => i.label), ...items.filter((i) => i.hint).map((i) => i.hint)].filter((t) => /\.$/.test(t));
  check(!dot.length, `etiquetas y ayudas sin punto final${dot.length ? ' — ' + dot.join(' | ') : ''}`);
  const jargon = texts.filter((t) => /\b(org[BL]?|lidMode|insertMode|WASM|manifold|grupo [AB]|hilo)\b/.test(t));
  check(!jargon.length, `sin jerga del motor${jargon.length ? ' — ' + jargon.join(' | ') : ''}`);
  const noDef = items.filter((i) => !(i.k in DEFAULTS));
  check(!noDef.length, `cada ajuste tiene valor por defecto${noDef.length ? ' — ' + noDef.map((i) => i.k).join(', ') : ''}`);
  const badRange = items.filter((i) => i.type === 'range' && !(i.min < i.max && i.step > 0 && DEFAULTS[i.k] >= i.min && DEFAULTS[i.k] <= i.max && typeof i.unit === 'string'));
  check(!badRange.length, `deslizadores con rango, paso y unidad, y el valor inicial dentro${badRange.length ? ' — ' + badRange.map((i) => i.k).join(', ') : ''}`);
  const badSel = items.filter((i) => i.type === 'select' && !(i.options.length >= 2 && i.options.some((o) => String(o[0]) === String(DEFAULTS[i.k]))));
  check(!badSel.length, `menús con ≥ 2 opciones y el valor inicial entre ellas${badSel.length ? ' — ' + badSel.map((i) => i.k).join(', ') : ''}`);
  const badWhen = [...SCHEMA, ...items].filter((x) => x.when !== undefined && typeof x.when !== 'function');
  check(!badWhen.length, '`when` siempre es una función de los parámetros');
  // Lo básico se ve sin tocar nada y con pocos controles por pestaña.
  for (const [tab, label] of TABS) {
    const vis = SCHEMA.filter((g) => g.tab === tab && (!g.when || g.when(DEFAULTS))).flatMap((g) => g.items.filter((i) => !i.adv && (!i.when || i.when(DEFAULTS))));
    check(vis.length >= 1 && vis.length <= 14, `${label}: ${vis.length} ajustes a la vista por defecto (≤ 14)`);
  }
  // Revelación progresiva de lo nuevo.
  const vis = (P, k) => SCHEMA.some((g) => (!g.when || g.when(P)) && g.items.some((i) => i.k === k && (!i.when || i.when(P))));
  const P0 = { ...DEFAULTS };
  check(!vis(P0, 'magnetD') && !vis(P0, 'orgLatch') && !vis(P0, 'orgCols') && !vis(P0, 'orgBCols') && !vis(P0, 'fingerD'), 'por defecto no se ven imanes, compartimentos ni huecos');
  check(vis({ ...P0, lidMode: 'org' }, 'orgCols') && vis({ ...P0, lidMode: 'org' }, 'orgLatch') && !vis({ ...P0, lidMode: 'org' }, 'orgBCols') && !vis({ ...P0, lidMode: 'org' }, 'magnetD'),
    'compartimentos en la tapa: aparecen sus ajustes y la traba, no los de la base ni los imanes');
  check(vis({ ...P0, insertMode: 'org', orgLatch: 'magnet' }, 'magnetD') && vis({ ...P0, insertMode: 'org', orgLatch: 'magnet' }, 'orgBCols'), 'compartimentos en la base con traba magnética: aparecen diámetro y altura del imán');
  check(!vis({ ...P0, insertMode: 'org', orgBCover: 'none', orgLatch: 'magnet' }, 'orgLatch'), 'sin tapa interior no se pregunta por la traba');
  check(vis({ ...P0, lidMode: 'pockets' }, 'fingerD') && vis({ ...P0, sealMode: 'cord' }, 'gasketCompression') === vis({ ...P0, sealMode: 'tpu' }, 'gasketCompression'), 'huecos en la tapa: aparecen los ajustes de huecos');
  const cm = contentModes({ ...P0, insertMode: 'org', lidMode: 'pockets' });
  check(cm.base === 'org' && cm.lid === 'pockets' && contentModes({ lidOrg: true, insertMode: 'blank' }).lid === 'org', 'cualquier combinación base/tapa (y los parámetros antiguos siguen valiendo)');
  // Una caja guardada con la versión anterior se abre igual.
  const old1 = migrate({ lidOrg: true, insertLid: false, insertMode: 'pockets' }), old2 = migrate({ insertLid: true }), old3 = migrate({ lidOrg: false, insertLid: false });
  check(old1.lidMode === 'org' && old1.insertMode === 'pockets' && !('lidOrg' in old1) && old2.lidMode === 'blank' && old3.lidMode === undefined,
    'las cajas guardadas con la versión anterior conservan su contenido');
  // Las 16 combinaciones base × tapa son válidas para el esquema.
  const modes = ['off', 'blank', 'pockets', 'org'];
  const combos = modes.flatMap((b) => modes.map((l) => contentModes({ ...P0, insertMode: b, lidMode: l })));
  check(combos.length === 16 && combos.every((c, i) => c.base === modes[i >> 2] && c.lid === modes[i & 3]), 'las 16 combinaciones de contenido (base × tapa) se respetan');
}

/* 5. HTML ----------------------------------------------------------- */
console.log('\nHTML');
{
  check(/<html lang="es">/.test(html) && /name="viewport"/.test(html) && /name="color-scheme"/.test(html), 'idioma, viewport y esquema de color');
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const unnamed = buttons.filter(([, attrs, inner]) => !/aria-label=/.test(attrs) && !inner.replace(/<[^>]+>/g, '').trim());
  check(buttons.length > 0 && !unnamed.length, `${buttons.length} botones con nombre accesible`);
  const inputs = [...html.matchAll(/<input\b([^>]*)>/g)].map((m) => m[1]);
  const idsLabeled = inputs.filter((a) => !/aria-label=/.test(a)).map((a) => (a.match(/id="([^"]+)"/) || [])[1]);
  const orphan = idsLabeled.filter((id) => !new RegExp(`<label[^>]*>[\\s\\S]{0,120}id="${id}"`).test(html));
  check(!orphan.length, `campos con etiqueta${orphan.length ? ' — ' + orphan.join(', ') : ''}`);
  check(/role="status"[^>]*aria-live="polite"/.test(html) && /role="toolbar"/.test(html) && /id="toasts"/.test(html), 'estado en vivo, barra de herramientas y notificaciones');
  check(/id="btnUndo"[^>]*disabled/.test(html) && /id="btnRedo"[^>]*disabled/.test(html), 'deshacer y rehacer en la cabecera');
  const upper = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').match(/\b[A-ZÁÉÍÓÚÑ]{4,}\b/g);
  check(!upper, `sin rótulos en mayúsculas${upper ? ' — ' + upper.join(', ') : ''}`);
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
