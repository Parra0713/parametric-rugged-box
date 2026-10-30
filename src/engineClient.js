/**
 * engineClient.js — Tres hilos de geometría con política "último pedido gana".
 *
 *   A, B  → vista rápida mientras se edita (calidad 'draft'): cada hilo
 *           construye la mitad de las piezas (A: base, junta, inserto;
 *           B: tapa, cierres, pasadores) y se unen con `mergeResults`.
 *   R     → modelo completo ('preview') cuando el usuario se detiene, y la
 *           exportación ('final'). Con ≥ 4 núcleos el modelo completo se
 *           reparte entre R (grupo A) y R2 (grupo B). Va en su propio hilo para que el cálculo
 *           largo (ayudas de impresión de cajas grandes) nunca retrase la
 *           vista rápida.
 *
 * En cada hilo solo se calcula un pedido a la vez y, al terminar, se salta al
 * más reciente: nunca se acumula trabajo atrasado. Los pedidos de
 * exportación tienen su propia cola y no los reemplaza la vista previa.
 *
 * Si un hilo falla (error de WASM, memoria), se descarta, se crea otro y el
 * pedido en curso se repite una vez: un fallo puntual ya no deja la vista
 * congelada sin aplicar los cambios.
 *
 * El Worker se incrusta en el propio HTML (?worker&inline, formato clásico),
 * por lo que funciona también abriendo el archivo con doble clic (file://).
 */
import EngineWorker from './worker.js?worker&inline';
import { mergeResults } from './engine/merge.js';

let seq = 0;

class Lane {
  constructor(name) {
    this.name = name;
    this.busy = null;                      // pedido en curso
    this.slots = { final: null, normal: null };
    this.spawn();
  }

  spawn() {
    this.worker?.terminate();
    this.worker = new EngineWorker();
    this.worker.onmessage = (e) => this._done(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this._done({ id: this.busy?.id, ok: false, fatal: true, error: 'El hilo de geometría falló: ' + (e.message || 'error desconocido') });
    };
  }

  /** kind: 'normal' (reemplazable) | 'final' (exportación, no se reemplaza). */
  run(kind, job) {
    return new Promise((resolve) => {
      const old = this.slots[kind];
      if (old && kind === 'normal') old.resolve({ superseded: true });
      if (old && kind === 'final') { this.slots[kind] = null; old.resolve({ superseded: true }); }
      this.slots[kind] = { ...job, id: ++seq, resolve, tries: 0, kind };
      this._pump();
    });
  }

  _pump() {
    if (this.busy) return;
    const job = this.slots.final || this.slots.normal;
    if (!job) return;
    if (job === this.slots.final) this.slots.final = null; else this.slots.normal = null;
    this.busy = job;
    const { resolve, tries, kind, ...msg } = job;
    this.worker.postMessage(msg);
  }

  _done(msg) {
    const job = this.busy;
    if (!job || msg.id !== job.id) return;
    this.busy = null;
    if (!msg.ok && msg.fatal) {
      this.spawn();
      // Reintenta una vez si no hay ya un pedido más nuevo esperando.
      const newer = this.slots.normal || this.slots.final;
      if (job.tries < 1 && !newer) {
        this.slots[job.kind] = { ...job, tries: job.tries + 1 };
        this._pump();
        return;
      }
    }
    job.resolve(msg);
    this._pump();
  }
}

export class EngineClient {
  constructor() {
    this.A = new Lane('A');
    this.B = new Lane('B');
    this.R = new Lane('R');
    // Con 4 núcleos o más, el modelo completo también se reparte en dos
    // hilos (R: grupo A, R2: grupo B): llega ~40 % antes al soltar el control.
    // Con menos núcleos competiría con la vista rápida: un solo hilo.
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    this.R2 = cores >= 4 ? new Lane('R2') : null;
  }

  /** Vista rápida repartida en dos hilos. */
  async draft(P, svg) {
    const q = { ...P, quality: 'draft' };
    const [a, b] = await Promise.all([
      this.A.run('normal', { P: q, svg, normals: true, only: 'A' }),
      this.B.run('normal', { P: q, svg, normals: true, only: 'B' }),
    ]);
    if (a.superseded || b.superseded) return { superseded: true };
    if (!a.ok) return a;
    if (!b.ok) return b;
    return { ok: true, r: mergeResults(a.r, b.r) };
  }

  /** Modelo completo para la vista (calidad 'preview'). */
  async refine(P, svg) {
    const q = { ...P, quality: 'preview' };
    if (!this.R2) return this.R.run('normal', { P: q, svg, normals: true });
    const [a, b] = await Promise.all([
      this.R.run('normal', { P: q, svg, normals: true, only: 'A' }),
      this.R2.run('normal', { P: q, svg, normals: true, only: 'B' }),
    ]);
    if (a.superseded || b.superseded) return { superseded: true };
    if (!a.ok) return a;
    if (!b.ok) return b;
    return { ok: true, r: mergeResults(a.r, b.r) };
  }

  /** Probetas del test de holguras (cola de exportación: no las reemplaza la vista previa). */
  calibration(P, plan) {
    return this.R.run('final', { P, calib: plan });
  }

  /** Modelo final para exportar (no lo reemplaza la vista previa). */
  final(P, svg) {
    return this.R.run('final', { P: { ...P, quality: 'final' }, svg, normals: false });
  }
}
