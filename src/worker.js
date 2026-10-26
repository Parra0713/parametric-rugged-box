/**
 * worker.js — Hilo de geometría. Toda la CSG ocurre aquí para que la vista 3D
 * y los controles sigan a 60 fps mientras se recalcula el modelo.
 * Las mallas se devuelven como ArrayBuffer transferibles (sin copia).
 *
 * Mensaje: { id, P, svg, normals, only }  (only: 'A' | 'B' | undefined)
 *          o { id, P, calib: plan } para el test de holguras (calib.js)
 * Respuesta: { id, ok, r } o { id, ok: false, error, fatal }. `fatal` indica
 * que el módulo WASM quedó en mal estado (desbordamiento de memoria, abort):
 * el cliente descarta este hilo y crea otro.
 */
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { init, build } from './engine/engine.js';
import { buildCalibration } from './engine/calib.js';

const ready = init(Module, wasmUrl);

self.onmessage = async (e) => {
  const { id, P, svg, normals, only, calib } = e.data;
  try {
    await ready;
    // Test de holguras: mismas piezas/mallas que una caja, otro generador.
    const r = calib ? buildCalibration(P, calib) : build(P, svg, { normals, only });
    const transfer = [];
    for (const p of r.parts) {
      transfer.push(p.mesh.vert.buffer, p.mesh.tri.buffer);
      for (const a of p.aids || []) transfer.push(a.mesh.vert.buffer, a.mesh.tri.buffer);
    }
    self.postMessage({ id, ok: true, r }, transfer);
  } catch (err) {
    const fatal = err instanceof WebAssembly.RuntimeError || /out of bounds|unreachable|Aborted|out of memory/i.test(String(err));
    self.postMessage({ id, ok: false, error: String(err?.stack || err), fatal });
  }
};
