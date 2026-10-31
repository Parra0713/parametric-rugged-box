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
 *        │ carril │  celda   │ div │  celda   │ pozo │ pared │
 *        │  ┌─┐   │          │     │          │      │       │
 *   zp1 ─┤  │●│   ┴──────────┴─────┴──────────┴─▄▄▄  │       │
 *   zp0 ─┘  └─┘    tapa interior (ct) + faldones  pestaña    │
 *        holgura g0 hasta el borde (Hb): la tapa interior no toca la base
 *
 *  - Bisagra de PIVOTES (v7.2): el borde de la tapa interior lleva un eje Ø3
 *    impreso (acostado, como los pasadores de la caja) cuyos extremos entran
 *    en agujeros CERRADOS de dos bloques de pivote (en las paredes de la tapa
 *    o, con una tapa por celda, entre celdas). Antes eran grapas en "C" con
 *    la boca hacia +Y: su brazo inferior se imprimía en el aire, era fino y
 *    el clic se gastaba. Ahora la carga de abrir y cerrar la lleva el agujero
 *    entero (no un clic) y el bloque se imprime sin voladizos: agujero en
 *    gota, esquina redondeada alrededor del eje y la ranura de montaje con
 *    chaflán a 45°. Montaje: se mete la tapa interior deslizándola hacia −Y
 *    con los pivotes por la ranura de cada bloque; al final saltan (clic) a
 *    su agujero (retén `lip`). Para sacarla hay que tirar hacia +Y; abrir y
 *    cerrar no la desmonta.
 *  - Cierre: un faldón por celda con holgura deslizante (sealClr, probeta C)
 *    y un resalte de clic (precarga calibrada, probeta E). El faldón también
 *    impide que las piezas pasen de una celda a otra con la tapa cerrada.
 *  - Apertura: en el borde libre de cada tapa interior, un pozo para el dedo
 *    (bolsillo cerrado, sin contacto con las celdas) y una pestaña de la tapa
 *    que asoma sobre la mitad del pozo: se mete la yema detrás y se tira.
 *  - Divisores desacoplados de la pared exterior por una ranura de 1 línea:
 *    al contraerse ya no tiran de la pared ni marcan el exterior.
 *  - Una tapa para todo (single), una por fila (row) o una por celda (cell).
 *  - Todo sin soportes: la tapa se imprime boca abajo (celdas, carriles y
 *    pozos hacia arriba, agujeros en gota); las tapas interiores, con la cara
 *    exterior sobre la cama (faldones hacia arriba).
 */

const r2 = (v) => Math.round(v * 100) / 100;

// Constantes de la bisagra y de la apertura.
export const ORG = {
  rho: 1.5,          // radio del eje (Ø3, el mismo diámetro que calibra P3)
  flat: 0.36,        // cara plana del eje sobre la cama (12 % del diámetro)
  wallB: 1.2,        // pared del bloque de pivote alrededor del agujero
  pinE: 1.2,         // lo que entra cada pivote en su agujero
  holeX: 0.3,        // fondo del agujero más allá de la punta del pivote
  notchX: 0.4,       // holgura en X entre la tapa interior y el bloque
  notchY: 0.85,      // holgura delante (+Y): el borde de la muesca gira bajo el bloque
  over: 0.9,         // pared entre el canal del eje y las celdas
  land: 1.0,         // apoyo del borde libre bajo el carril siguiente
  skirtH: 2.0,       // altura del faldón
  // Pozo para el dedo (apertura) y pestaña de la tapa interior sobre él.
  wellW: 16, wellD: 10, wellH: 6, tabFrac: 0.45,
};

/** Holgura de giro en Ø3 (la de la calibración, interpolada como en derive). */
const clr3 = (P) => P.clearance ?? 0.25;

/** Ranura que separa divisores y carriles de la pared exterior (1 línea). */
export const decoupleGap = (lw) => r2(Math.max(0.5, lw + 0.05));

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
  const a = ORG.rho + clr3(P);                              // radio del agujero del pivote
  // Holgura hasta el borde: el bloque de pivote baja hasta la punta de la
  // gota de su agujero + 1 mm de pared, y queda 0.4 mm por encima del borde.
  const g0 = has ? r2(Math.max(2.4, a * Math.SQRT2 + 1.4 - ORG.rho + ORG.flat)) : 0.4;
  // Eje a `rB` de la cara del carril: deja pared (≥ 2 líneas) entre el canal
  // del eje y la ranura de desacople, y el bloque de pivote dentro.
  const gap = decoupleGap(lw);
  const rB = r2(Math.max(gap + 0.9, ORG.wallB) + 0.2);
  const rail0 = has ? r2(rB + 2 * a + ORG.over) : 0;
  const railMid = has && cover !== 'single' ? r2(ORG.land + 0.4 + ORG.rho + a + ORG.over) : wd;
  const needL = P.orgMinL > 0 ? r2(cols * P.orgMinL + (cols - 1) * wd) : 0;
  const needW = P.orgMinW > 0 ? r2(rows * P.orgMinW + rail0 + (rows - 1) * railMid) : 0;
  const needDl = P.orgDepth > 0 ? r2(g0 + ct + P.orgDepth) : 0;
  return { cols, rows, cover, wd, ct, g0, a, rB, gap, rail0, railMid, needL, needW, needDl, has };
}

/**
 * Semiancho del interior (|x| máx.) a la altura y: esquinas redondeadas
 * (radio ri) y octógono (recorte de 45° de pierna cham).
 */
function halfWidthAt(D, y) {
  const L = D.Li, W = D.Wi, ri = D.ri || 0.5, cham = D.cham || 0;
  const ay = Math.abs(y);
  if (cham > 0) return L / 2 - Math.max(0, ay - (W / 2 - cham)) - 0.3 * ri - 0.3;
  const dy = ay - (W / 2 - ri);
  return dy > 0 ? L / 2 - ri + Math.sqrt(Math.max(0, ri * ri - dy * dy)) : L / 2;
}

/**
 * Distribución completa (números): celdas, carriles, ejes, pivotes, pozos y
 * tapas interiores. Marco interno de la tapa cerrada; borde de la tapa en z = Hb.
 */
export function orgLayout(D, P) {
  const B = orgBase(P, D.lw);
  if (!B) return null;
  const { cols, rows, cover, wd, ct, g0, a, rB, gap, rail0, railMid, has } = B;
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
  // Bloque de pivote (perfil YZ alrededor del eje): ±(a + wallB) en Y, de la
  // punta de la gota − 1 mm hasta zp1.
  const blockR = r2(a + ORG.wallB);
  const zb = r2(za - a * Math.SQRT2 - 1.0);
  const hd = r2(ORG.pinE + ORG.holeX);                      // fondo del agujero
  // Retén del clic de montaje: la ranura de entrada es `lip` menos profunda
  // que lo que entra el pivote (precarga calibrada, probeta E).
  const lip = r2(Math.min(0.45, Math.max(0.3, (D.pre ?? 0.15) + 0.15)));

  const axes = [];
  const panels = [];
  const blocks = [];
  const wells = [];
  if (has) {
    const nAx = cover === 'single' ? 1 : rows;
    for (let r = 0; r < nAx; r++) {
      const yR = r === 0 ? -W / 2 : rowsY[r - 1][1];                 // cara −Y del carril
      const ya = r === 0 ? yR + rB + a : yR + ORG.land + 0.4 + ORG.rho;
      axes.push({ r, y: r2(ya), z: za, railY0: r2(yR), railY1: r2(ya + a + ORG.over) });
    }
    const yEnd = (r) => (cover === 'single' || r === rows - 1 ? W / 2 - 0.3 : rowsY[r][1] + ORG.land);
    // Cara interior del bloque de pared a la altura del eje (agujero de
    // profundidad hd hasta la pared, en la parte más estrecha del bloque).
    // Entre el fondo del agujero y la ranura de desacople de la pared quedan
    // ≥ 2 líneas (en las esquinas redondeadas la pared se acerca).
    const wallFace = (ya) => {
      let m = Infinity;
      for (let k = 0; k <= 8; k++) m = Math.min(m, halfWidthAt(D, ya - a + (2 * a * k) / 8));
      return r2(m - gap - 0.9 - hd);
    };
    const mk = (x0, x1, r, rLast, cellIdx, pl, pr) => {
      const ax = axes[cover === 'single' ? 0 : r];
      // pl/pr: cara del bloque de la izquierda/derecha (el pivote entra en −X/+X).
      return {
        x0: r2(x0), x1: r2(x1), ax0: r2(pl - ORG.pinE), ax1: r2(pr + ORG.pinE), y0: ax.y, y1: r2(yEnd(rLast)),
        row: r, rowLast: rLast, axis: ax, pivots: [r2(pl), r2(pr)], tab: r2((x0 + x1) / 2), cells: cellIdx,
      };
    };
    const idx = (r, c) => r * cols + c;
    const addWallBlocks = (ax) => {
      const f = wallFace(ax.y);
      blocks.push({ axis: ax, x0: -f, s: -1 }, { axis: ax, x0: f, s: 1 });
      return f;
    };
    if (cover === 'single' || cover === 'row') {
      for (const ax of axes) {
        const f = addWallBlocks(ax);
        if (cover === 'single') panels.push(mk(-L / 2 + 0.3, L / 2 - 0.3, 0, rows - 1, cells.map((_, i) => i), -f, f));
        else panels.push(mk(-L / 2 + 0.3, L / 2 - 0.3, ax.r, ax.r, Array.from({ length: cols }, (_, c) => idx(ax.r, c)), -f, f));
      }
    } else {
      // Una tapa por celda: bloques en las paredes y, entre celdas, bloques
      // dobles centrados en el divisor (agujero desde cada lado).
      for (const ax of axes) {
        const f = addWallBlocks(ax);
        const r = ax.r;
        const mids = [];
        for (let c = 0; c < cols - 1; c++) {
          const xd = (cells[idx(r, c)].x1 + cells[idx(r, c + 1)].x0) / 2;
          const half = r2(hd + 0.45);                                // 0.9 de pared entre agujeros
          blocks.push({ axis: ax, x0: r2(xd - half), x1: r2(xd + half), mid: true });
          mids.push([r2(xd - half), r2(xd + half)]);
        }
        for (let c = 0; c < cols; c++) {
          const cl = cells[idx(r, c)];
          const x0 = c === 0 ? -L / 2 + 0.3 : cl.x0 - wd / 2 + 0.3;
          const x1 = c === cols - 1 ? L / 2 - 0.3 : cl.x1 + wd / 2 - 0.3;
          const pl = c === 0 ? -f : mids[c - 1][1];
          const pr = c === cols - 1 ? f : mids[c][0];
          panels.push(mk(x0, x1, r, r, [idx(r, c)], pl, pr));
        }
      }
    }
    // Pozo para el dedo en el borde libre de cada tapa interior, por dentro
    // de su propia huella (no pisa la tapa de la fila siguiente ni su eje):
    // la tapa interior cubre la primera parte (pestaña) y deja descubierta la
    // del borde. Celdas muy pequeñas: sin pozo (no cabe un dedo).
    for (const p of panels) {
      const ww = Math.min(ORG.wellW, p.x1 - p.x0 - 4);
      const atWall = p.y1 >= W / 2 - 0.31;
      // Bajo un carril, el pozo acaba donde acaban las celdas (deja el carril
      // entero entre él y el canal del eje siguiente).
      const yw1 = atWall ? W / 2 : p.y1 - ORG.land;
      // La pared del pozo que mira al eje queda a ≥ 12 mm de él: al empezar a
      // abrir, el faldón de la tapa interior junto a esa pared avanza hacia +Y
      // antes de bajar y, más cerca, rozaría.
      const wdp = Math.min(ORG.wellD, cellW - 3, yw1 - p.axis.y - 12 - wd);
      if (ww < 10 || wdp < 7) { p.well = null; continue; }
      const yw0 = yw1 - wdp;
      const w = { x0: r2(p.tab - ww / 2), x1: r2(p.tab + ww / 2), y0: r2(yw0), y1: r2(yw1),
        yTab: r2(yw0 + ORG.tabFrac * (yw1 - yw0)), h: r2(Math.min(ORG.wellH, depth - 1.5)), atWall };
      if (w.h < 3) { p.well = null; continue; }
      p.well = w;
      wells.push(w);
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
    for (const p of panels) p.lim = r2(Math.min(...p.cells.map((i) => cells[i].lim)));
  }
  if (has) {
    // Celdas con resalte de clic: las del borde libre (single), los extremos
    // de cada fila (row) o todas (cell).
    for (const p of panels) {
      p.snapCells = cover === 'cell' ? p.cells
        : cover === 'row' ? [p.cells[0], p.cells[p.cells.length - 1]]
          : p.cells.filter((i) => cells[i].r === rows - 1);
    }
  }
  return {
    ...B, cellL, cellW, depth, zp0, zp1, za, zi, zb, hd, lip, blockR, cells, axes, panels, blocks, wells,
    // Resalte de clic: sobresale la holgura deslizante + la interferencia
    // (precarga calibrada del cierre, probeta E, acotada a 0.15–0.35 mm).
    snap: P._orgNoSnap ? (D.sealClr ?? 0.25) : r2((D.sealClr ?? 0.25) + Math.min(0.35, Math.max(0.15, (D.pre ?? 0.15) + 0.05))), sealClr: D.sealClr ?? 0.25,
    rc: r2(Math.min(2.5, cellL / 4, cellW / 4)),
    // Fondo inclinado (modo ahorro: 3 mm en vez de 6; es macizo y pesa).
    scoop: P.orgScoop !== false ? r2(Math.min(P._eco ? 3 : 6, depth / 3, cellL / 4, cellW / 4)) : 0,
  };
}
