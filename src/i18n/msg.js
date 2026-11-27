/**
 * Mensajes estructurados del motor.
 *
 * El motor (que corre en un hilo aparte y cuyos resultados se guardan en
 * caché) NO escribe frases: devuelve `{ k, p }` (clave + datos) y la interfaz
 * los pone en el idioma elegido con `tm()` (src/i18n/index.js). Así cambiar
 * de idioma no obliga a recalcular la caja y las cachés valen para todos.
 *
 *   warn.push(M('warn.lidMin', { mm: DlMin }))
 *
 * Los datos pueden llevar otros mensajes dentro (p. ej. `where: M('side.base')`).
 */
export const M = (k, p) => (p ? { k, p } : { k });

/** ¿Es un mensaje estructurado? */
export const isMsg = (x) => !!x && typeof x === 'object' && typeof x.k === 'string';
