/**
 * Configuración de Vite.
 *  - `npm run dev`   → servidor local con recarga en caliente.
 *  - `npm run build` → dist/rugged-box.html: UN ÚNICO archivo autocontenido
 *    (HTML + JS + WASM en base64). Se abre con doble clic, sin internet ni
 *    servidor.
 */
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  worker: { format: 'iife' },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,   // incrusta el .wasm como data: URI
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  server: { port: 5173, open: true },
});
