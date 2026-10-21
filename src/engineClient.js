/**
 * engineClient.js — Cliente del motor con política "último pedido gana".
 *
 * Mientras el usuario arrastra un deslizador se generan decenas de pedidos;
 * solo se calcula uno a la vez y, al terminar, se salta directamente al más
 * reciente. Nunca se acumula trabajo atrasado (latencia acotada a una
 * reconstrucción) y la CPU no se satura.
 *
 * El Worker se incrusta en el propio HTML (?worker&inline, formato clásico),
 * por lo que funciona también abriendo el archivo con doble clic (file://).
 */
import EngineWorker from './worker.js?worker&inline';

export class EngineClient {
  constructor() {
    this.seq = 0;
    this.busy = false;
    this.pending = null;
    this.waiters = new Map();
    this.worker = new EngineWorker();
    this.worker.onmessage = (e) => this._done(e.data);
    this.worker.onerror = (e) => {
      const id = this.current?.id;
      this._done({ id, ok: false, error: 'El hilo de geometría falló: ' + (e.message || 'error desconocido') });
    };
  }

  /**
   * Pide una reconstrucción. La promesa se resuelve con el resultado, o con
   * { superseded: true } si un pedido más nuevo la reemplazó antes de empezar.
   */
  request(P, svg, normals = true) {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
      if (this.pending) {
        this.waiters.get(this.pending.id)?.({ superseded: true });
        this.waiters.delete(this.pending.id);
      }
      this.pending = { id, P, svg, normals };
      this._pump();
    });
  }

  _pump() {
    if (this.busy || !this.pending) return;
    this.current = this.pending;
    this.pending = null;
    this.busy = true;
    this.worker.postMessage(this.current);
  }

  _done(msg) {
    this.busy = false;
    const w = this.waiters.get(msg.id);
    this.waiters.delete(msg.id);
    w?.(msg);
    this._pump();
  }
}
