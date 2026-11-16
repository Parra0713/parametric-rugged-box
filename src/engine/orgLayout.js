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
 *
 * EN LA BASE (v7.3): el mismo organizador, girado 180° sobre el eje X que pasa
 * por el plano de unión (y → −y, z → 2·Hb − z). Toda la distribución y la
 * geometría se calculan en el "marco de tapa" (el de arriba) y el motor las
 * gira: las celdas quedan abiertas hacia arriba desde el suelo, las tapas
 * interiores justo bajo el borde, con el eje en el lado de las bisagras de la
 * caja (se abren hacia el fondo) y el pozo para el dedo delante. Impresa de
 * pie, la base ve exactamente lo que ve la tapa impresa boca abajo.
 *
 * TRABA de la tapa interior (`orgLatch`):
 *  - 'snap' (mecánica): resaltes de clic en los faldones (arriba).
 *  - 'magnet' (magnética): parejas de imanes de disco Ø × alto dados. Uno va
 *    en un resalte de la cara interior de la tapa interior y el otro en un
 *    pilar del cuerpo, cara con cara (0.4 mm de separación): tiran en la
 *    dirección de apertura, que es como más sujetan. Alojamientos ciegos a
 *    presión con 6 nervios de aplastamiento y chaflán de entrada (el patrón
 *    de los agujeros de imán de Gridfinity): se meten con el dedo o un
 *    tornillo de banco después de imprimir, sin pausar la impresión. Los
 *    pilares van sobre un divisor o en una esquina, junto al borde libre.
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

// Alojamiento de imán a presión (medidas sobre el imán nominal).
export const MAG = {
  slack: 0.25,       // radio del agujero = imán/2 + slack (entra sin tocar la pared)
  bite: 0.05,        // los nervios de aplastamiento muerden el imán 0.05 mm por lado
  ribs: 6,           // nervios de aplastamiento
  recess: 0.1,       // la cara del imán queda 0.1 mm por debajo del borde
  air: 0.2,          // aire entre el resalte de la tapa interior y el pilar
  skin: 0.6,         // piel bajo el imán de la tapa interior (3 capas)
  lead: 0.4,         // chaflán de entrada
  sinkY: 0.2,        // lo que el pilar se funde con el carril del borde libre
};

/**
 * Qué lleva cada mitad de la caja: 'off' | 'blank' | 'pockets' | 'org'.
 * Admite los parámetros antiguos (`lidOrg`, `insertLid`).
 */
export function contentModes(P) {
  const ok = (v) => (['off', 'blank', 'pockets', 'org'].includes(v) ? v : 'off');
  const base = ok(P.insertMode);
  const lid = ok(P.lidMode) !== 'off' ? ok(P.lidMode) : P.lidOrg ? 'org' : P.insertLid ? 'blank' : 'off';
  return { base, lid };
}

/** Parámetros del organizador de un lado ('lid' | 'base'). */
function orgParams(P, side) {
  return side === 'base'
    ? { cols: P.orgBCols, rows: P.orgBRows, minL: P.orgBMinL, minW: P.orgBMinW, depth: P.orgBDepth, cover: P.orgBCover, scoop: P.orgBScoop }
    : { cols: P.orgCols, rows: P.orgRows, minL: P.orgMinL, minW: P.orgMinW, depth: P.orgDepth, cover: P.orgCover, scoop: P.orgScoop };
}

/** Cotas del alojamiento de imán (null si la traba no es magnética). */
function magnetDims(P, lw, ct) {
  if (P.orgLatch !== 'magnet') return null;
  const d = Math.min(20, Math.max(2, Number(P.magnetD) || 6));
  const h = Math.min(8, Math.max(0.5, Number(P.magnetH) || 2));
  const lh = P.layerH || 0.2;
  // Agujero vertical: sale algo más pequeño; se compensa a medias (los
  // nervios absorben el resto).
  const comp = (P.holeComp ?? 0.15) / 4;
  const rOut = r2(d / 2 + MAG.slack + comp), rIn = r2(d / 2 - MAG.bite + comp);
  const wall = r2(Math.max(1.2, 3 * lw));
  const pd = r2(h + MAG.recess);
  // Resalte de la tapa interior: lo que el imán no cabe en su espesor.
  const hb = r2(Math.max(0, Math.ceil((pd + MAG.skin - ct) / lh - 1e-6) * lh));
  // Cuántos por tapa interior: 0 = automático (lo sugerido por la carga).
  const count = Math.min(8, Math.max(0, Math.round(Number(P.magnetCount) || 0)));
  return { d, h, rOut, rIn, wall, Rp: r2(rOut + wall), pd, hb, count, pull: magnetPull(d, h) };
}

/**
 * Fuerza estimada (gramos) con la que se sujetan dos imanes de disco N35
 * iguales, cara con cara a 0.4 mm. Campo en el eje de un disco
 * (B = Br/2·[(z+h)/√((z+h)²+R²) − z/√(z²+R²)], Br = 1.2 T) a media
 * separación, fuerza B²A/2μ0 y un factor 4 que ajusta la fórmula a los
 * valores de catálogo (6×2 ≈ 0.5 kg en contacto); luego la mitad, por lo que
 * un imán barato y un alojamiento impreso dan de menos. Es una ESTIMACIÓN
 * para sugerir cuántos poner, no un dato de catálogo.
 */
export function magnetPull(d, h) {
  const R = d / 2, z = (MAG.air + 2 * MAG.recess) / 2;
  const B = 0.6 * ((z + h) / Math.hypot(z + h, R) - z / Math.hypot(z, R));
  const N = (B * B * Math.PI * R * R * 1e-6) / (2 * 4e-7 * Math.PI);
  return Math.round((N / 9.81) * 1000 * 4 * 0.5);
}

/**
 * Carga estimada (gramos) que deben sujetar los imanes de una tapa interior:
 * sus celdas medio llenas de tornillería (≈ 3 g/cm³ a granel), la mitad la
 * lleva la bisagra, y ×1.5 por las sacudidas al abrir la caja.
 */
export const coverLoad = (volCm3) => Math.round(volCm3 * 0.5 * 3 * 0.5 * 1.5);

/** Holgura de giro en Ø3 (la de la calibración, interpolada como en derive). */
const clr3 = (P) => P.clearance ?? 0.25;

/** Ranura que separa divisores y carriles de la pared exterior (1 línea). */
export const decoupleGap = (lw) => r2(Math.max(0.5, lw + 0.05));

/** Parámetros básicos (sin geometría): para dimensionar la caja. */
export function orgBase(P, lw, side = 'lid') {
  if (contentModes(P)[side] !== 'org') return null;
  const Q = orgParams(P, side);
  const cols = Math.max(1, Math.round(Q.cols || 1));
  const rows = Math.max(1, Math.round(Q.rows || 1));
  const cover = ['single', 'row', 'cell', 'none'].includes(Q.cover) ? Q.cover : 'single';
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
  const needL = Q.minL > 0 ? r2(cols * Q.minL + (cols - 1) * wd) : 0;
  const needW = Q.minW > 0 ? r2(rows * Q.minW + rail0 + (rows - 1) * railMid) : 0;
  const needDl = Q.depth > 0 ? r2(g0 + ct + Q.depth) : 0;
  const magnet = has ? magnetDims(P, lw, ct) : null;
  return { side, cols, rows, cover, wd, ct, g0, a, rB, gap, rail0, railMid, needL, needW, needDl, has, magnet, scoopOn: Q.scoop !== false };
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
export function orgLayout(D, P, side = 'lid') {
  const B = orgBase(P, D.lw, side);
  if (!B) return null;
  const { cols, rows, cover, wd, ct, g0, a, rB, gap, rail0, railMid, has } = B;
  const L = D.Li, W = D.Wi;
  const zp0 = r2(D.Hb + g0), zp1 = r2(zp0 + ct);
  // Fondo de las celdas en el marco de tapa: el techo de la tapa o, para la
  // base (girada 180°), su suelo.
  const zi = r2(D.Hb + (side === 'base' ? D.Db : D.Dl));
  const za = r2(zp0 + ORG.rho - ORG.flat);
  const depth = r2(zi - zp1);
  const cellL = r2((L - (cols - 1) * wd) / cols);
  const cellW = r2((W - rail0 - (rows - 1) * railMid) / rows);
  const cells = [];
  const rowsY = [];
  // Todo sobre una rejilla de 0.01 mm desde la misma esquina: así las celdas
  // (y luego las tapas interiores, bloques y pozos) de una fila salen
  // EXACTAMENTE iguales y se construyen e imprimen como una pieza repetida,
  // en vez de diferir en una centésima por el redondeo.
  const xL = r2(-L / 2);
  let y = r2(-W / 2 + rail0);
  for (let r = 0; r < rows; r++) {
    rowsY.push([y, r2(y + cellW)]);
    for (let c = 0; c < cols; c++) {
      const x0 = r2(xL + c * (cellL + wd));
      cells.push({ r, c, x0, x1: r2(x0 + cellL), y0: y, y1: r2(y + cellW) });
    }
    y = r2(y + cellW + railMid);
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
      const X0 = r2(x0), X1 = r2(x1);
      return {
        x0: X0, x1: X1, ax0: r2(pl - ORG.pinE), ax1: r2(pr + ORG.pinE), y0: ax.y, y1: r2(yEnd(rLast)),
        row: r, rowLast: rLast, axis: ax, pivots: [r2(pl), r2(pr)], tab: r2(X0 + r2((X1 - X0) / 2)), cells: cellIdx,
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
        const half = r2(hd + 0.45);                                  // 0.9 de pared entre agujeros
        const offB = r2(wd / 2 - half);                              // cara del bloque desde la cara de la celda
        const over = r2(wd / 2 - 0.3);                               // lo que la tapa interior pisa del divisor
        for (let c = 0; c < cols - 1; c++) {
          const xf = r2(cells[idx(r, c)].x1 + offB);
          blocks.push({ axis: ax, x0: xf, x1: r2(xf + 2 * half), mid: true });
          mids.push([xf, r2(xf + 2 * half)]);
        }
        for (let c = 0; c < cols; c++) {
          const cl = cells[idx(r, c)];
          const x0 = c === 0 ? -L / 2 + 0.3 : cl.x0 - over;
          const x1 = c === cols - 1 ? L / 2 - 0.3 : cl.x1 + over;
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
      let ww = Math.min(ORG.wellW, p.x1 - p.x0 - 4);
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
      // Octógono / esquinas muy redondeadas: el pozo se corre hacia el centro
      // lo justo para quedar dentro del interior (si no, mordía la pared en
      // diagonal de las celdas de las esquinas).
      const hw = Math.min(halfWidthAt(D, yw1 - 0.01), halfWidthAt(D, yw0)) - 0.5;
      if (p.tab + ww / 2 > hw) p.tab = r2(hw - ww / 2);
      if (p.tab - ww / 2 < -hw) p.tab = r2(-hw + ww / 2);
      if (p.tab - ww / 2 < p.x0 + 2 || p.tab + ww / 2 > p.x1 - 2) { p.well = null; p.tab = r2((p.x0 + p.x1) / 2); continue; }
      // Tapa de una celda con imán en la esquina: el pozo se estrecha lo justo
      // para dejarle sitio (hasta 10 mm; con menos no cabe un dedo).
      if (B.magnet) {
        const row = p.cells.map((i) => cells[i]).filter((c) => c.r === p.rowLast);
        if (row.length === 1) {
          // (2 líneas de pared entre el pozo y la boca achaflanada del alojamiento.)
          const fit = 2 * (magCorners(D, B, row[0], row[0])[1] - p.tab - 0.9 - B.magnet.rOut - MAG.lead) - 0.02;
          if (fit >= 10) ww = Math.min(ww, r2(fit));
        }
      }
      const w = { x0: r2(p.tab - ww / 2), x1: r2(p.tab + ww / 2), y0: r2(yw0), y1: r2(yw1),
        yTab: r2(yw0 + ORG.tabFrac * (yw1 - yw0)), h: r2(Math.min(ORG.wellH, depth - 1.5)), atWall };
      if (w.h < 3) { p.well = null; continue; }
      p.well = w;
      wells.push(w);
    }
  }
  // Celdas que pisan un pozo (con su pared alrededor): se recortan.
  for (const c of cells) {
    c.wells = wells.map((w, i) => (w.x0 - wd < c.x1 && w.x1 + wd > c.x0 && w.y0 - wd < c.y1 && w.y1 + wd > c.y0 ? i : -1)).filter((i) => i >= 0);
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
  // Traba magnética: pilares + resaltes (si no caben, se vuelve al clic).
  let latch = 'snap', magnets = [], magnetWarn = null, magnetInfo = null;
  if (has && B.magnet) {
    const res = placeMagnets(D, B, { cells, panels, rowsY, depth, cellL, cellW });
    if (res.ok) { latch = 'magnet'; magnets = res.magnets; magnetInfo = res.info; } else magnetWarn = res.why;
  }
  for (const c of cells) c.mags = magnets.map((m, i) => (m.x - B.magnet.Rp < c.x1 && m.x + B.magnet.Rp > c.x0 && m.y - B.magnet.Rp < c.y1 && m.y + B.magnet.Rp > c.y0 ? i : -1)).filter((i) => i >= 0);
  if (has) {
    // Celdas con resalte de clic: las del borde libre (single), los extremos
    // de cada fila (row) o todas (cell). Con imanes, ninguna.
    for (const p of panels) {
      p.snapCells = latch === 'magnet' ? [] : cover === 'cell' ? p.cells
        : cover === 'row' ? [p.cells[0], p.cells[p.cells.length - 1]]
          : p.cells.filter((i) => cells[i].r === rows - 1);
    }
  }
  return {
    ...B, latch, magnets, magnetWarn, magnetInfo,
    cellL, cellW, depth, zp0, zp1, za, zi, zb, hd, lip, blockR, cells, axes, panels, blocks, wells,
    // Resalte de clic: sobresale la holgura deslizante + la interferencia
    // (precarga calibrada del cierre, probeta E, acotada a 0.15–0.35 mm).
    snap: P._orgNoSnap ? (D.sealClr ?? 0.25) : r2((D.sealClr ?? 0.25) + Math.min(0.35, Math.max(0.15, (D.pre ?? 0.15) + 0.05))), sealClr: D.sealClr ?? 0.25,
    // Retén del borde libre (traba mecánica): resalte de la cara +Y del
    // faldón que salta a una muesca en V de la pared exterior. `detI` es lo
    // que hay que vencer (0.4 mm); encajado queda SIN tensión (no cede con
    // el tiempo). `detK`: lo que sobresale el resalte del faldón.
    detI: 0.4, detK: r2((D.sealClr ?? 0.25) + (P._orgNoSnap ? 0 : 0.4)),
    rc: r2(Math.min(2.5, cellL / 4, cellW / 4)),
    // Fondo inclinado (modo ahorro: 3 mm en vez de 6; es macizo y pesa).
    scoop: B.scoopOn ? r2(Math.min(P._eco ? 3 : 6, depth / 3, cellL / 4, cellW / 4)) : 0,
  };
}

/** Centros en X de un pilar en la esquina izquierda / derecha de una fila de celdas. */
function magCorners(D, B, first, last) {
  // Junto a un divisor el pilar se funde 0.2 mm con él (como con el carril).
  const Rp = B.magnet.Rp, sinkX = Math.min(MAG.sinkY, Math.max(0, B.wd / 2 - 0.35));
  return [
    first.c === 0 ? -D.Li / 2 + B.gap + Rp : first.x0 + Rp - sinkX,
    last.c === B.cols - 1 ? D.Li / 2 - B.gap - Rp : last.x1 - Rp + sinkX,
  ];
}

/**
 * Posiciones de los imanes de cada tapa interior (marco de tapa). El pilar
 * del cuerpo va junto al borde libre: centrado en un divisor (tapas de
 * varias celdas: medio disco en cada celda) o en una esquina (tapas de una
 * celda). Nunca toca la pared exterior (queda tras la ranura de desacople),
 * el pozo para el dedo ni sale del interior.
 */
function placeMagnets(D, B, G) {
  const { gap, magnet: Mg } = B;
  const { cells, panels, rowsY, depth } = G;
  const L = D.Li, W = D.Wi, Rp = Mg.Rp;
  if (depth < Mg.hb + MAG.air + Mg.pd + 0.8) return { ok: false, why: `celdas de ${depth} mm de alto: el imán de ${Mg.h} mm necesita ${r2(Mg.hb + MAG.air + Mg.pd + 0.8)} mm` };
  const inside = (x, y) => {
    for (let k = 0; k < 12; k++) {
      const px = x + Rp * Math.cos((k * Math.PI) / 6), py = y + Rp * Math.sin((k * Math.PI) / 6);
      if (Math.abs(py) > W / 2 - gap + 0.02 || Math.abs(px) > halfWidthAt(D, py) - gap + 0.02) return false;
    }
    return true;
  };
  const out = [];
  for (const p of panels) {
    const atWall = p.y1 >= W / 2 - 0.31;
    const yEdge = atWall ? W / 2 - gap : rowsY[p.rowLast][1] + MAG.sinkY;
    const y = r2(yEdge - Rp);
    const row = p.cells.map((i) => cells[i]).filter((c) => c.r === p.rowLast);
    const cand = [];
    // Divisores interiores a la tapa.
    // (`xa`/`xb`: hasta dónde llega en X el resalte de la tapa interior: la
    // cara del divisor vecino si el pilar va en una esquina junto a él.)
    for (let k = 0; k < row.length - 1; k++) cand.push({ x: r2((row[k].x1 + row[k + 1].x0) / 2), corner: false, xa: -1e4, xb: 1e4 });
    // Esquinas: contra la pared (tras la ranura) o contra el divisor vecino.
    const first = row[0], last = row[row.length - 1];
    const [xl, xr] = magCorners(D, B, first, last);
    cand.push({ x: r2(xr), corner: true, xa: -1e4, xb: last.c === B.cols - 1 ? 1e4 : last.x1 },
      { x: r2(xl), corner: true, xa: first.c === 0 ? -1e4 : first.x0, xb: 1e4 });
    const w = p.well;
    const ok = (c) => inside(c.x, y) && (!p.lim || Math.abs(c.x) + Rp <= p.lim)
      && c.x - Rp >= p.x0 - 0.01 && c.x + Rp <= p.x1 + 0.01
      && (!w || Math.abs(c.x - (w.x0 + w.x1) / 2) >= (w.x1 - w.x0) / 2 + 0.9 + Mg.rOut + MAG.lead - 0.005 || y + Mg.rOut + MAG.lead < w.y0 - 0.9);
    const valid = cand.filter(ok);
    if (!valid.length) return { ok: false, why: `no cabe un imán de Ø${Mg.d} mm junto al borde libre (celdas de ${G.cellL}×${G.cellW} mm)` };
    const width = p.x1 - p.x0, mid = (p.x0 + p.x1) / 2;
    const sep = 2 * Rp + 1;
    // Sugerencia: los que hacen falta para la carga estimada (mínimo 2 en
    // tapas anchas, para que no se levante una esquina).
    const vol = p.cells.reduce((a, i) => a + (cells[i].x1 - cells[i].x0) * (cells[i].y1 - cells[i].y0), 0) * depth / 1000;
    const load = coverLoad(vol);
    const suggested = Math.min(6, Math.max(row.length > 1 || width >= 60 ? 2 : 1, Math.ceil(load / Math.max(1, Mg.pull))));
    const want = Mg.count || suggested;
    let picked;
    if (row.length === 1) {
      // Tapa de una celda: una esquina (la derecha: todas iguales) o las dos.
      const right = valid.find((c) => c.corner && c.x > mid), left = valid.find((c) => c.corner && c.x < mid);
      picked = want >= 2 && right && left && right.x - left.x >= sep ? [left, right] : [right || left || valid[0]];
    } else {
      // Varias celdas: reparto SIMÉTRICO respecto al centro de la tapa (la
      // pestaña está en el centro: si se tira de ella, los imanes sueltan a la
      // vez). Parejas ±x y, si el número es impar, uno central; si el centro
      // lo ocupa el pozo, una pareja más.
      const center = valid.find((c) => Math.abs(c.x - mid) < 0.05);
      const pairs = valid.filter((c) => c.x > mid + 0.05 && valid.some((q) => Math.abs(q.x + c.x - 2 * mid) < 0.05))
        .sort((u, v) => u.x - v.x);
      let n = Math.min(want, 2 * pairs.length + (center ? 1 : 0));
      if (n % 2 && !center) n = n + 1 <= 2 * pairs.length ? n + 1 : n - 1;
      const half = [];
      for (let i = 0; i < Math.floor(n / 2); i++) {
        const t = mid + ((i + 0.5 + (n % 2) / 2) * width) / n;
        const best = pairs.filter((c) => !half.includes(c) && half.every((q) => Math.abs(q.x - c.x) >= sep)
          && c.x - mid >= (n % 2 ? sep : sep / 2))
          .sort((u, v) => Math.abs(u.x - t) - Math.abs(v.x - t))[0];
        if (best) half.push(best);
      }
      picked = half.flatMap((c) => [c, valid.find((q) => Math.abs(q.x + c.x - 2 * mid) < 0.05)]);
      if (n % 2 && center) picked.push(center);
      if (!picked.length) picked = [center || valid[0]];
    }
    // `yc`: cara del carril del borde libre (el resalte de la tapa interior y
    // su hueco en el cuerpo no pasan de ahí); `xa`/`xb`: lo mismo en X.
    p.magnets = picked.map((c) => ({ x: c.x, y, yc: atWall ? null : r2(rowsY[p.rowLast][1]), xa: c.xa, xb: c.xb })).sort((u, v) => u.x - v.x);
    p.magnetPlan = { suggested, load, asked: Mg.count, placed: p.magnets.length };
    for (const m of p.magnets) out.push({ ...m, panel: panels.indexOf(p) });
  }
  // Resumen para la interfaz: lo sugerido, lo puesto y si lo pedido no cabe.
  const plans = panels.map((p) => p.magnetPlan);
  const short = Mg.count && plans.some((q) => q.placed < Mg.count);
  const info = {
    pull: Mg.pull, load: Math.max(...plans.map((q) => q.load)), suggested: Math.max(...plans.map((q) => q.suggested)),
    asked: Mg.count, placed: plans.map((q) => q.placed),
    note: short ? `solo caben ${Math.min(...plans.map((q) => q.placed))} imanes por tapa interior de los ${Mg.count} pedidos` : null,
  };
  return { ok: true, magnets: out, info };
}
