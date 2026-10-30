/**
 * orgLayout.js — Organizador en la tapa (parte pura, sin geometría): cuadrícula de compartimentos
 * integrada en la tapa y "tapas interiores" que los cierran.
 *
 * Con la caja cerrada la tapa está boca abajo: los compartimentos se abren
 * hacia la base y lo que contienen descansa sobre las tapas interiores. Al
 * abrir la caja (tapa a 180°) quedan boca arriba y cada tapa interior se
 * levanta para sacar las piezas.
 *
 * Sección (mundo, caja cerrada; Z hacia arriba = techo de la tapa):
 *
 *        techo de la tapa (zi) ───────────────────────────────
 *        │ carril │  celda   │ div │  celda   │      pared │
 *        │  ┌─┐   │          │     │          │            │
 *   zp1 ─┤  │●│◄──┼── eje ───┴─────┴──────────┴── tapa interior (ct)
 *   zp0 ─┘  └C┘   └─ faldón con resalte (entra en cada celda, clic) ─┘
 *        holgura g0 hasta el borde (Hb): la tapa interior no toca la base
 *
 *  - Bisagra a presión SIN piezas sueltas: la tapa interior lleva un eje Ø3
 *    impreso en su borde (acostado, como los pasadores de la caja) que entra
 *    de lado en grapas en "C" del carril. Nada que perder.
 *  - Cierre: un faldón por celda con holgura deslizante (sealClr, probeta C)
 *    y un resalte de clic (precarga calibrada, probeta E). El faldón también
 *    impide que las piezas pasen de una celda a otra con la tapa cerrada.
 *  - Una tapa para todo (single), una por fila (row) o una por celda (cell).
 *  - Pestaña para la uña en el borde libre, con su rebaje en la pared.
 *  - Todo sin soportes: la tapa se imprime boca abajo (celdas y carriles
 *    hacia arriba, agujero de las grapas en gota); las tapas interiores, con
 *    la cara exterior sobre la cama (faldones hacia arriba).
 */

const r2 = (v) => Math.round(v * 100) / 100;

// Constantes de la bisagra a presión.
export const ORG = {
  rho: 1.5,          // radio del eje (Ø3, el mismo diámetro que calibra P3)
  flat: 0.36,        // cara plana del eje sobre la cama (12 % del diámetro)
  back: 1.0,         // pared de la grapa hacia −Y
  front: 1.2,        // brazo de la grapa hacia +Y (boca)
  notch: 0.4,        // holgura lateral (X) de la muesca de la tapa alrededor de la grapa
  notchY: 0.85,      // holgura delante (+Y): el borde de la muesca gira por debajo de la grapa
  over: 0.4,         // el carril cubre la muesca (sin rendijas hacia la celda)
  land: 1.0,         // apoyo del borde libre bajo el carril siguiente
  clipL: 4.0,        // largo de cada grapa (a lo largo del eje)
  open: 0.85,        // boca de la grapa = 0.85 · Ø del eje (clic al entrar)
  skirtH: 2.0,       // altura del faldón
  tabW: 7, tabL: 1.2, // pestaña para la uña
};

/** Holgura de giro en Ø3 (la de la calibración, interpolada como en derive). */
const clr3 = (P) => P.clearance ?? 0.25;

/** Parámetros básicos (sin geometría): para dimensionar la caja. */
export function orgBase(P, lw) {
  if (!P.lidOrg) return null;
  const cols = Math.max(1, Math.round(P.orgCols || 1));
  const rows = Math.max(1, Math.round(P.orgRows || 1));
  const cover = ['single', 'row', 'cell', 'none'].includes(P.orgCover) ? P.orgCover : 'single';
  // Divisores ≥ 3 líneas y tapa interior de 4 (modo ahorro: 2 y 3 líneas).
  const wd = r2(P._eco ? Math.max(0.9, 2 * lw) : Math.max(1.2, 3 * lw));
  const has = cover !== 'none';
  // Nervado: la tapa interior baja a 5 capas; sus faldones (2 mm, sobre el
  // borde de cada celda) hacen de nervios y le devuelven la rigidez.
  const ct = has ? r2(P._ecoRib ? Math.max(1.0, 5 * (P.layerH || 0.2)) : P._eco ? Math.max(1.2, 3 * lw) : Math.max(1.6, 4 * lw)) : 0;
  const a = ORG.rho + clr3(P);                              // radio del agujero de la grapa
  // Holgura hasta el borde: la grapa baja hasta la punta de la gota de su
  // agujero + 1 mm de pared (antes 0.5 mm: techo frágil al imprimir).
  const g0 = has ? r2(Math.max(2.4, a * Math.SQRT2 + 1.2 - ORG.rho + ORG.flat)) : 0.4;
  const rail0 = has ? r2(ORG.back + 2 * a + ORG.front + ORG.notchY + ORG.over) : 0;
  const railMid = has && cover !== 'single' ? r2(ORG.land + 0.4 + ORG.back + 2 * a + ORG.front + ORG.notchY + ORG.over) : wd;
  const needL = P.orgMinL > 0 ? r2(cols * P.orgMinL + (cols - 1) * wd) : 0;
  const needW = P.orgMinW > 0 ? r2(rows * P.orgMinW + rail0 + (rows - 1) * railMid) : 0;
  const needDl = P.orgDepth > 0 ? r2(g0 + ct + P.orgDepth) : 0;
  return { cols, rows, cover, wd, ct, g0, a, rail0, railMid, needL, needW, needDl, has };
}

/**
 * Distribución completa (números): celdas, carriles, ejes, tapas interiores.
 * Marco interno de la tapa cerrada; el borde de la tapa está en z = Hb.
 */
export function orgLayout(D, P) {
  const B = orgBase(P, D.lw);
  if (!B) return null;
  const { cols, rows, cover, wd, ct, g0, a, rail0, railMid, has } = B;
  const L = D.Li, W = D.Wi;
  const zp0 = r2(D.Hb + g0), zp1 = r2(zp0 + ct);
  const zi = r2(D.Hb + D.Dl);
  const za = r2(zp0 + ORG.rho - ORG.flat);
  const depth = r2(zi - zp1);
  const cellL = r2((L - (cols - 1) * wd) / cols);
  const cellW = r2((W - rail0 - (rows - 1) * railMid) / rows);
  const cells = [];
  const rowsY = [];
  let y = -W / 2 + rail0;
  for (let r = 0; r < rows; r++) {
    rowsY.push([y, y + cellW]);
    for (let c = 0; c < cols; c++) {
      const x0 = -L / 2 + c * (cellL + wd);
      cells.push({ r, c, x0: r2(x0), x1: r2(x0 + cellL), y0: r2(y), y1: r2(y + cellW) });
    }
    y += cellW + railMid;
  }
  // Ejes de bisagra: uno por fila (row/cell) o solo el primero (single).
  const axes = [];
  const panels = [];
  if (has) {
    const nAx = cover === 'single' ? 1 : rows;
    for (let r = 0; r < nAx; r++) {
      const yR = r === 0 ? -W / 2 : rowsY[r - 1][1];                 // cara −Y del carril
      const ya = r === 0 ? yR + ORG.back + a : yR + ORG.land + 0.4 + ORG.back + a;
      axes.push({ r, y: r2(ya), z: za, railY0: r2(yR), railY1: r2(ya + a + ORG.front + ORG.notchY + ORG.over) });
    }
    const yEnd = (r) => (cover === 'single' || r === rows - 1 ? W / 2 - 0.3 : rowsY[r][1] + ORG.land);
    // Esquinas recortadas (octógono): el eje y las grapas se quedan dentro de
    // la cuerda del interior a la altura del carril (si no, asomarían por la
    // pared en diagonal y el eje rozaría al girar).
    const chord = (yy) => L / 2 - Math.max(0, Math.abs(yy) - (W / 2 - (D.cham || 0))) - (D.cham > 0 ? 0.3 * D.ri + 0.6 : 0.3);
    const mk = (x0, x1, r, rLast, cellIdx) => {
      const ax = axes[cover === 'single' ? 0 : r];
      const hA = Math.min(chord(ax.y - a - ORG.back), chord(ax.y + a + ORG.front + ORG.notchY)) - (D.cham > 0 ? ORG.rho + 0.4 : 0);
      const ax0 = Math.max(x0, -hA), ax1 = Math.min(x1, hA);
      const c0 = ax0 + ORG.clipL / 2 + 0.5, c1 = ax1 - ORG.clipL / 2 - 0.5;
      const span = c1 - c0;
      const nClip = span < 2 * ORG.clipL ? 1 : Math.max(2, 2 * Math.ceil(span / 80));
      const clips = nClip === 1 ? [r2((c0 + c1) / 2)]
        : Array.from({ length: nClip }, (_, k) => r2(c0 + (span * k) / (nClip - 1) * 0.8 + span * 0.1));
      return { x0: r2(x0), x1: r2(x1), ax0: r2(ax0), ax1: r2(ax1), y0: ax.y, y1: r2(yEnd(rLast)), row: r, rowLast: rLast, axis: ax, clips, tab: r2((x0 + x1) / 2), cells: cellIdx };
    };
    const idx = (r, c) => r * cols + c;
    if (cover === 'single') {
      panels.push(mk(-L / 2 + 0.3, L / 2 - 0.3, 0, rows - 1, cells.map((_, i) => i)));
    } else if (cover === 'row') {
      for (let r = 0; r < rows; r++) panels.push(mk(-L / 2 + 0.3, L / 2 - 0.3, r, r, Array.from({ length: cols }, (_, c) => idx(r, c))));
    } else {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const cl = cells[idx(r, c)];
        const x0 = c === 0 ? -L / 2 + 0.3 : cl.x0 - wd / 2 + 0.3;
        const x1 = c === cols - 1 ? L / 2 - 0.3 : cl.x1 + wd / 2 - 0.3;
        panels.push(mk(x0, x1, r, r, [idx(r, c)]));
      }
    }
    // Octógono: la parte de cada celda que queda más allá de la cuerda del
  // interior a la altura de su eje se rellena (si no, la esquina de la tapa
  // interior rozaría la pared en diagonal al abrir). Sin octógono, nada.
  if (has && D.cham > 0) {
    const chordR = (yy) => L / 2 - Math.max(0, Math.abs(yy) - (W / 2 - D.cham));
    for (const c of cells) {
      const ax = axes[cover === 'single' ? 0 : c.r];
      c.lim = r2(chordR(ax.y) - (0.3 * D.ri + 0.6) - 0.3);
    }
    for (const p of panels) p.lim = r2(Math.min(...p.cells.map((i) => cells[i].lim)) - 0.3 + 0.3);
  }
  // Celdas con resalte de clic: las del borde libre (single), los extremos
    // de cada fila (row) o todas (cell).
    for (const p of panels) {
      p.snapCells = cover === 'cell' ? p.cells
        : cover === 'row' ? [p.cells[0], p.cells[p.cells.length - 1]]
          : p.cells.filter((i) => cells[i].r === rows - 1);
    }
  }
  return {
    ...B, cellL, cellW, depth, zp0, zp1, za, zi, cells, axes, panels,
    // Resalte de clic: sobresale la holgura deslizante + la interferencia
    // (precarga calibrada del cierre, probeta E, acotada a 0.15–0.35 mm).
    snap: P._orgNoSnap ? (D.sealClr ?? 0.25) : r2((D.sealClr ?? 0.25) + Math.min(0.35, Math.max(0.15, (D.pre ?? 0.15) + 0.05))), sealClr: D.sealClr ?? 0.25,
    rc: r2(Math.min(2.5, cellL / 4, cellW / 4)),
    // Fondo inclinado (modo ahorro: 3 mm en vez de 6; es macizo y pesa).
    scoop: P.orgScoop !== false ? r2(Math.min(P._eco ? 3 : 6, depth / 3, cellL / 4, cellW / 4)) : 0,
  };
}

