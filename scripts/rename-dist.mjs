// Renombra dist/index.html → dist/rugged-box.html (archivo único distribuible).
import { renameSync, existsSync } from 'node:fs';
if (existsSync('dist/index.html')) renameSync('dist/index.html', 'dist/rugged-box.html');
console.log('✔ dist/rugged-box.html listo (ábrelo con doble clic)');
