/**
 * worker.js — Hilo de geometría. Toda la CSG ocurre aquí para que la vista 3D
 * y los controles sigan a 60 fps mientras se recalcula el modelo.
 * Las mallas se devuelven como ArrayBuffer transferibles (sin copia).
 */
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { init, build } from './engine/engine.js';

const ready = init(Module, wasmUrl);

self.onmessage = async (e) => {
  const { id, P, svg, normals } = e.data;
  try {
    await ready;
    const r = build(P, svg, { normals });
    const transfer = [];
    for (const p of r.parts) transfer.push(p.mesh.vert.buffer, p.mesh.tri.buffer);
    self.postMessage({ id, ok: true, r }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.stack || err) });
  }
};
