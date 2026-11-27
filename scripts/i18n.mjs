#!/usr/bin/env node
/**
 * Herramienta de traducciones.
 *
 *   node scripts/i18n.mjs check        comprueba todos los idiomas
 *   node scripts/i18n.mjs new <code>   crea src/i18n/locales/<code>.js
 *
 * `check` falla (código 1) si:
 *   - un idioma tiene claves que el español no tiene (erratas),
 *   - el inglés no tiene todas las claves (español de es.js + ajustes de SCHEMA),
 *   - los huecos `{x}` de un texto no coinciden con los del español,
 *   - el código usa una clave que no existe (t('…'), Msg('…'), data-i18n).
 * A los demás idiomas les puede faltar texto: se muestra cuánto y se usa el
 * inglés mientras tanto.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, schemaKeys } from '../src/i18n/index.js';
import { TABS, SCHEMA } from '../src/engine/params.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const es = { ...schemaKeys(TABS, SCHEMA), ...LOCALES.es };
const ALL = Object.keys(es);
const holes = (v) => (typeof v === 'string' ? [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',') : null);

/** Claves que el código usa de forma literal. */
export function usedKeys() {
  const out = new Set();
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) { if (f.name !== 'locales') walk(p); continue; }
      if (!/\.(js|mjs|html)$/.test(f.name)) continue;
      const s = readFileSync(p, 'utf8');
      for (const m of s.matchAll(/(?<![.\w])(?:t|Msg|has)\(\s*'([a-zA-Z][\w.]*)'/g)) out.add(m[1]);
      for (const m of s.matchAll(/data-i18n(?:-title|-aria)?="([\w.]+)"/g)) out.add(m[1]);
      for (const m of s.matchAll(/new Error\('((?:err)\.[\w.]+)'\)/g)) out.add(m[1]);
    }
  };
  walk(join(ROOT, 'src'));
  for (const m of readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/data-i18n(?:-title|-aria)?="([\w.]+)"/g)) out.add(m[1]);
  return out;
}

export function check() {
  const errors = [], notes = [];
  for (const [code, d] of Object.entries(LOCALES)) {
    if (code === 'es') continue;
    const extra = Object.keys(d).filter((k) => !(k in es));
    if (extra.length) errors.push(`${code}: claves que no existen en español: ${extra.join(', ')}`);
    const missing = ALL.filter((k) => !(k in d));
    if (missing.length) (code === 'en' ? errors : notes).push(`${code}: faltan ${missing.length} claves${code === 'en' ? `: ${missing.join(', ')}` : ' (se usa el inglés)'}`);
    for (const k of Object.keys(d)) {
      const a = holes(es[k]), b = holes(d[k]);
      if (a != null && b != null && a !== b) errors.push(`${code}: «${k}» tiene huecos {${b}} y el español {${a}}`);
      if (typeof es[k] !== typeof d[k] && !(Array.isArray(es[k]) && typeof d[k] === 'function') && !(typeof es[k] === 'function' && (typeof d[k] === 'string' || Array.isArray(d[k]))) && !(typeof es[k] === 'string' && typeof d[k] === 'function'))
        errors.push(`${code}: «${k}» es ${typeof d[k]} y en español ${typeof es[k]}`);
    }
  }
  const used = usedKeys();
  const unknown = [...used].filter((k) => !(k in es) && !k.endsWith('.'));
  if (unknown.length) errors.push(`el código usa claves que no existen: ${unknown.join(', ')}`);
  return { errors, notes };
}

/** Plantilla de un idioma nuevo: todas las claves con el texto en inglés. */
function template(code) {
  const file = join(ROOT, 'src/i18n/locales', `${code}.js`);
  if (existsSync(file)) { console.error(`Ya existe ${file}`); process.exit(1); }
  const src = readFileSync(join(ROOT, 'src/i18n/locales/en.js'), 'utf8')
    .replace(/^\/\*\*[\s\S]*?\*\/\n/, `/**\n * ${code}: traducción. Parte del inglés: cambia cada texto y borra las\n * claves que no traduzcas (se usará el inglés).\n */\n`)
    .replace(/'meta\.name': '[^']*'/, `'meta.name': '${code}'`)
    .replace(/'meta\.locale': '[^']*'/, `'meta.locale': '${code}'`);
  writeFileSync(file, src);
  console.log(`Creado ${file}.\nAhora: tradúcelo, añade "${code}" a LOCALES en src/i18n/index.js y ejecuta: node scripts/i18n.mjs check`);
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const [cmd, arg] = direct ? process.argv.slice(2) : ['import'];
if (cmd === 'import') { /* usado como módulo (pruebas) */ }
else if (cmd === 'new' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(arg || '')) template(arg);
else if (cmd === 'check' || !cmd) {
  const { errors, notes } = check();
  for (const n of notes) console.log('· ' + n);
  for (const e of errors) console.error('✗ ' + e);
  if (errors.length) process.exit(1);
  console.log(`✔ Traducciones correctas (${Object.keys(LOCALES).join(', ')}; ${ALL.length} claves)`);
} else {
  console.log('Uso: node scripts/i18n.mjs check | new <código>');
}
