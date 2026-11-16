# CLAUDE.md — Rugged Box

Generador web paramétrico de cajas tipo *rugged box* imprimibles en FDM.
Todo el texto de la interfaz, comentarios y mensajes de commit van **en
español**. Unidades: milímetros y grados.

## Comandos

```bash
npm run dev          # servidor Vite con recarga (http://localhost:5173)
npm run build        # dist/rugged-box.html: UN archivo autocontenido (doble clic)
npm test             # geometría + cama + montaje real (~2 min)
npm run test:org     # compartimentos (tapa y base, clic o imanes): cierra, abre 0–95°, sin soportes
npm run test:guide   # guía de interfaz: contraste AA, textos, sin alert/confirm, recursos liberados
npm run test:ui      # interfaz en Chromium (tras `npm run build`; se omite si no hay Playwright)
npm run test:calib   # test de holguras: plan adaptativo, probetas imprimibles, resultados y perfiles
npm run test:perf    # memoria WASM (fugas y pico por construcción), reparto A/B, vista rápida y cachés (~3 min)
npm run test:budget  # presupuestos de tiempo por función + línea base (~2 min)
npm run eco:compare  # comparativa del modo ahorro: gramos de laminador, rigidez y tiempo
node tests/budget.test.mjs --update      # guardar la línea base (tests/perf-baseline.json)
npm run test:assembly   # mecánica completa, pasadores montables, puentes ≤ 10 mm, apilado (~45 s)
npm run test:quick   # barrido rápido de tamaños (7 casos, ~15 s)
npm run test:sweep   # barrido completo de 20 a 380 mm (~25 casos, ~30 s–2 min)
node tests/sweep.test.mjs --chunk=1/3   # trocear en máquinas lentas
node tests/sweep.test.mjs --filter=apil # solo casos cuyo nombre contenga…
```

Los barridos escriben `logs/sweep-<fecha>.log` (detalle por caso, incluido el
registro interno del motor) y `logs/sweep-latest.json` (resumen). **Ejecuta
`npm run test:sweep` antes de cada commit que toque `src/engine/`.**

## Arquitectura

| Archivo | Responsabilidad |
|---|---|
| `src/engine/params.js` | `DEFAULTS`, `SCHEMA` (la UI se genera de aquí), `derive(P)` → objeto `D` con TODAS las cotas. Función pura. |
| `src/engine/geo.js` | Primitivas sobre manifold-3d, `installGC`/`cleanup` (memoria WASM). |
| `src/engine/seal.js` | `rrOffset(D, d)`: contorno interior desplazado (rectángulo u octógono). Ranuras, lengüetas, junta, `stackLines`. |
| `src/engine/hinge.js`, `latch.js`, `pins.js` | Mecánica. Lado de montaje de cada pasador: `D.hinge.headSide`, `D.latch.headSide` (params.js). |
| `src/engine/pattern.js` | Patrones de tapa, logo SVG, interfaz de apilado. |
| `src/engine/insert.js` | Insertos de la base y de la tapa (`baseInsert`, `lidInsert`: en blanco / con alojamientos + huecos para dedos; mismo núcleo `insertCore`). |
| `src/engine/tilt.js` | Impresión inclinada: bisel de contacto, aletas, detector de voladizos y soportes. |
| `src/engine/engine.js` | Orquestador `build(P, svg, opt)`; ayudas de impresión (`addAids`); registro `D.log`. |
| `src/bedfit.js`, `src/optimizer.js` | Cama: rotación/diagonal/inclinación; optimizador "imprimir plana". |
| `src/content.js` | SVG calcado del contenido (unidades reales, recorte máx. de esquina). |
| `src/packer.js` | Acomodo automático de varios objetos (gravedad sobre rejilla de 1 mm, giros 90/180/270°, huecos para dedos compartibles, prefiere cajas que quepan planas). Pura JS. |
| `src/main.js`, `viewer.js`, `worker.js` | UI, vista three.js (render bajo demanda), hilo de geometría. |
| `src/style.css`, `docs/GUIA-INTERFAZ.md` | Variables de diseño y componentes; la guía de interfaz (obligatoria, ver abajo). |
| `src/engine/orgLayout.js`, `organizer.js` | Compartimentos en tapa y base: `contentModes(P)` (qué lleva cada mitad), `orgBase(P, lw, side)` (dimensionado, en `derive`), `orgLayout(D, P, side)` → `D.org` (tapa) / `D.orgB` (base): celdas, ejes, tapas interiores, pozos, imanes. Geometría: `orgCavity(D, O, zB)`, `orgMech(D, O)` (bloques, pilares, cortes) y `orgPanel(D, O, p)`. |
| `src/engine/calib.js`, `src/calibProfile.js` | Test de holguras: `calibPlan` (puro), `buildCalibration` (probetas, hilo R), `applyResults` (puro); perfiles persistentes. |
| `src/engineClient.js`, `src/engine/merge.js` | Tres hilos: A + B (vista rápida `draft`, cada uno media caja: `build(P, svg, { only })`) y R (modelo completo `preview` y exportación `final`). `mergeResults` une A y B. |

## Convenciones y trampas conocidas

- **Marco interno**: X = lado LARGO (bisagras en +Y, cierres en −Y), fondo del
  cuerpo de la base en z = 0. Si `innerW > innerL` se modela girado
  (`D.rot90`) y el visor lo gira; el SVG del logo/contenido se rota en
  `svg.js` / `content.js`.
- Cada pieza: `mesh` (marco nativo), `print` (nativo → impresión, columna
  mayor), `instances` (nativo → ensamblaje), `aids` (ayudas ya en impresión).
  La tapa se imprime volteada (`print[5] < 0`: invierte Y).
- **Toda la forma sale de `rrOffset`**: no dibujes contornos con
  `roundRect` directamente o el octógono dejará de propagarse.
- **Bisel de contacto (inclinada)**: NUNCA debe tocar la mecánica →
  `mechanicsKeepOut`. Un bisel sin esa protección recortaba nudillos y
  mejillas (piezas "incompletas o raras").
- Las cotas derivadas que dependan de la impresora se ajustan a líneas/capas
  (`snapW`, `snapH`).
- `baseCache` reutiliza la base: añade a `LID_ONLY` cualquier parámetro nuevo
  que NO afecte a la base (si afecta, no lo añadas). Lo que solo afecta a
  veces va aparte en la clave (`holeComp` con imanes en la base en
  `baseKey`; los `orgB*` que agrandan la caja en `lidKey`). El logo entra
  en `lidKey` con su contenido (`svgSig`).
- El contenido viaja dentro de `P` hacia el worker: `P.contentObjects =
  [{ polys, notches }]` (acomodado por `packer.js`, marco interno). El motor
  no acomoda: solo recorta huecos y huecos para dedos donde le dicen.
  `P.contentPolys` (un objeto) se mantiene por compatibilidad y pruebas.
- La UI se genera de `SCHEMA` (pestaña `tab`, `adv` = solo con «Ajustes
  avanzados», `hint` = ayuda de una línea sin punto final, `when: (P) =>
  bool` en un ajuste o en un grupo = solo se muestra cuando aplica). No
  añadas controles a mano en `main.js`. `SCHEMA` lleva funciones: no viaja
  a los hilos (solo `P`).
- Las ayudas de impresión (`addAids`) se aplican a base, tapa, insertos y tapas interiores; el
  parámetro `G` describe el contorno y si hay mecánica que proteger.
- Memoria WASM: todo objeto creado se libera en `cleanup()` al final de
  `build`; no guardes `Manifold`/`CrossSection` entre llamadas. En las
  pruebas, un `build()` extra va ANTES de crear tus propios `Manifold`: al
  terminar libera también los tuyos (uso tras liberar = el proceso muere). `installGC`
  envuelve el prototipo REAL de las instancias (no `W.Manifold.prototype`,
  que es otro objeto): si no, nada encadenado se libera (~30 MB por
  reconstrucción, el hilo acaba en "memory access out of bounds").
  `CrossSection.extrude/revolve` se reemplazan porque manifold‑3d no libera
  su vector de polígonos. `tests/perf.test.mjs` vigila la memoria.
- **Pico de memoria** (la memoria WASM nunca se devuelve: cada hilo se queda
  con su máximo): `mark()` / `release(m, keep)` de geo.js liberan antes de
  tiempo lo creado desde una marca. `build` lo hace al acabar cada pieza
  (malla + ayudas hechas) y `addAidsRaw`/tilt.js en cada etapa y en cada
  capa de sus bucles. Reglas: (1) todo lo que se use DESPUÉS de un
  `release` va en `keep` o se creó antes de la marca (H y L se crean antes
  de todas); (2) una caché de geometría que viva toda la construcción se
  marca con `pin()` (p. ej. la forma del octógono en `rrOffset`); (3) usar
  un objeto liberado lanza "Cannot pass deleted object": ejecuta el barrido
  completo tras tocar esto. `tests/mempeak.test.mjs` mide el pico de cada
  caja en un proceso nuevo y tiene presupuesto (205 mm, 18 tapas interiores,
  inclinada: 375 → 145 MB).
- Soportes de voladizos (`overhangSupports`): la holgura con la pieza se
  resta en seis pasos evaluados (no la unión de seis copias casi iguales) y
  el aligerado es UN hueco (el soporte bajado 2 capas ∩ celdas de la
  rejilla), no rejilla + piel + pie unidos: mismas caras coincidentes =
  doble de tiempo y +95 MB.
- Calidades: `draft` (vista rápida: `D.seg` 20, sin `criticalLayers` ni
  `addAids`), `preview` (40) y `final` (96). Lo que se omita en `draft` debe
  ser un detalle que llega con el modelo completo, nunca mecánica.
- Grupos de `build(…, { only })`: A = base, junta, inserto de la base,
  tapas interiores de la TAPA; B = tapa, cierre, pasadores, tapones, inserto
  de la tapa, tapas interiores de la BASE (cada hilo lleva una mitad y las
  tapas interiores de la otra: van parejos). Una pieza nueva
  va en uno de los dos (si no, la vista rápida no la muestra) y la prueba de
  reparto de `perf.test.mjs` comprueba que A + B = completo.
- Cachés en engine.js: `baseCache` (LID_ONLY), `lidCache` (todo salvo
  NOT_LID: contenido, insertos, ayudas), `solidMemo` (inserto, tapas
  interiores, relieve de la tapa; SIEMPRE devuelve el sólido rehecho desde la
  malla guardada, para que acierto y fallo den la misma triangulación),
  `aidsMemo` (huella de la malla + `AID_KEYS`) y `critMemo`. Si una pieza
  empieza a leer un parámetro nuevo, revisa LID_ONLY / NOT_LID / su clave:
  `perf.test.mjs` prueba cada parámetro de esas listas.
- El modelo completo ('preview') se reparte en dos hilos (R: grupo A, R2:
  grupo B) si `navigator.hardwareConcurrency ≥ 4`; la exportación ('final')
  sigue en un hilo.
- **Rendimiento de cada función nueva**: añade su entrada en `FEATURES` de
  `tests/budget.test.mjs` (con presupuesto de vista rápida, cambio de tapa,
  cambio de contenido y modelo completo, en ms de la máquina de referencia),
  ejecuta `node tests/budget.test.mjs --update` y sube
  `tests/perf-baseline.json` en el mismo commit. La prueba falla si se pasa
  del presupuesto o empeora > 50 % frente a la línea base.
- **Modo ahorro** (`eco`, `ecoParams` en params.js): solo transforma
  parámetros que REDUCEN material (pared 4 líneas ≥ 1.6, fondo/techo 5–6
  capas, banda ≤ 2.4 pero con ≥ 2 líneas a cada lado de la ranura, sin
  nervios de esquina, grabado con piel mínima bajo las celdas (`_ecoEngrave`; antes relieve: dejaba la cara colgando), inserto y organizador
  finos). Nunca toca mecánica ni holguras; con `eco: false` es la identidad.
  `ecoDesign`: 'min' | 'rib' (ligero) | 'ribStiff' (rígido) → `P._ecoRib`,
  piel de 3 líneas y `D.wallRibs` (params.js `wallRibs`/`ribbedI`; geometría
  `wallRibZone`/`wallRibAxes` en engine.js). Los nervios no salen de rr(F),
  evitan esquinas, mecánica ± (2.5 + bo) y un tubo alrededor de cada eje.
  Con apilable cae a mínimos.
- `src/engine/estimate.js`: gramos de laminador (perímetros, capas sólidas,
  relleno, capa a capa) y minutos aproximados. Úsalo (no el volumen
  macizo) para comparar diseños; `tests/estimate.test.mjs` lo valida.
- **Holguras = perfil de la impresora** (`CAL_KEYS` en calib.js: filClr,
  clearance (Ø3), clearanceL (Ø5, se interpola por diámetro), tiltAdd,
  holeComp, sealClr, axialGap, stackClr, latchPre, insertTol, pocketTol).
  Cada probeta reproduce su unión EN LA ORIENTACIÓN DE IMPRESIÓN de la caja
  (tabla al principio de calib.js). `build` predice con `fitsFlat` si la
  caja irá inclinada y re-deriva con `P._tilted` → `D.tilted`/`D.tiltAdd`
  solo en agujeros de bisagra y orejetas (el barril del cierre, pieza suelta
  de lado, no). Las pruebas que comparan con `derive` deben usar el mismo
  `_tilted` que el motor (ver sweep).
  Sus valores vienen del perfil activo, no de los parámetros guardados de la
  caja ni del enlace. Una holgura nueva: añádela a `CAL_KEYS`/`CAL_LIMITS`,
  al grupo "Calibración de holguras" del SCHEMA (`cal: true`) y, si se puede
  medir, a `calibPlan`/`applyResults`. Usa `D.filClr` (filamento), `D.clr`
  (pasador impreso), `D.sealClr` (lengüeta), `D.sclr` (apilado): no
  reutilices una para otra cosa.
- **Contenido de cada mitad**: `D.content = { base, lid }` con 'off' |
  'blank' | 'pockets' | 'org' (de `insertMode` y `lidMode`; los antiguos
  `lidOrg`/`insertLid` se siguen aceptando y `migrate` los convierte). OJO:
  `D.fill` es el llenado de la junta, no esto.
- **Compartimentos en la base** (`D.orgB`): es el organizador de la tapa
  calculado en el "marco de tapa" y girado 180° sobre el eje X del plano de
  unión (`orgFlip(D)`: y → −y, z → 2·Hb − z). TODO lo de organizer.js y
  orgLayout.js se escribe una sola vez en el marco de tapa; nunca dupliques
  código "para la base". Sus tapas interiores usan la misma malla e
  impresión, con `side: 'base'`, clave `orgPanelB{k}`, instancias
  `T(z0)·orgFlip·T(dx,dy)` y eje reflejado; el visor no les aplica el giro
  de la tapa. Las pruebas llevan la base al marco de tapa con el mismo giro.
  Con placa Gridfinity en la base no hay compartimentos (aviso).
- **Traba magnética** (`orgLatch: 'magnet'`, `magnetD`, `magnetH`; cotas en
  `MAG`): parejas de imanes cara con cara a 0.4 mm, uno en un pilar del
  cuerpo (`O.magnets`, sobre un divisor o en la esquina junto al borde
  libre, tras la ranura de desacople) y otro en un resalte de la tapa
  interior (`p.magnets`). Alojamiento ciego con 6 nervios y chaflán
  (`magnetPocket`, se construye una vez y se copia; en `draft`, cilindro
  liso). El resalte y su hueco no pasan de la cara del carril ni del divisor
  vecino (`m.yc`, `m.xa/xb`): si no, adelgazan la pared de al lado. Reparto
  simétrico respecto a la pestaña. Sin sitio → `O.magnetWarn` y clic.
  Cantidad por tapa interior: `magnetCount` (0 = automático). La sugerencia
  sale de `magnetPull(d, h)` (fuerza estimada de una pareja) y `coverLoad`
  (celdas medio llenas de tornillería); `O.magnetInfo` lo resume para la
  interfaz y avisa si lo pedido no cabe. Son estimaciones: dilo así.
- **Traba mecánica** (`orgLatch: 'snap'`): resaltes de fricción en los
  faldones (±X) más un RETÉN en el borde libre (`detentSpots`,
  `O.detI`/`O.detK`): resalte a 45° en la cara +Y del faldón que salta a una
  muesca en V de la pared exterior y queda sin tensión. Solo en tapas
  interiores cuyo borde libre da a la pared exterior (un carril intermedio
  lleva el canal del eje siguiente: no admite muesca). Nervio de agarre
  bajo la pestaña, dentro del pozo.
- Las tapas interiores pasan por `addAids` como las demás piezas (impresión
  centrada; orejas, o inclinada con aletas y soportes). `G.noCut`: sin
  bisel de contacto (una placa fina apoya en su canto).
- **Junta de cordón** (`sealMode: 'cord'`): filamento TPU Ø1.75 crudo;
  `D.gap` = Ø·(1 − c), `D.gw` para llenar ≤ 85 %, sin pieza `gasket`;
  `D.cord.length` (grupo A) = perímetro del eje de la ranura + 1 %.
- La cuadrícula de celdas va sobre una rejilla de 0.01 mm desde la misma
  esquina (orgLayout): así las tapas interiores iguales tienen la MISMA
  firma y se agrupan. No metas medias centésimas (p. ej. `wd / 2` sin
  redondear) en posiciones de tapas, bloques o pozos.
- En `D` solo van datos (se serializa a JSON): nada de objetos WASM. Las
  celdas guardan `c.wells`/`c.mags` (índices y posiciones), no secciones.
- **Organizador**: con la caja cerrada las celdas se abren hacia la base y
  las tapas interiores (`orgPanel`) van entre `D.org.zp0` y `zp1`,
  por encima del borde (`g0`). Bisagra de PIVOTES: eje Ø3 (holgura P3) en el
  borde de la tapa interior, cuyos extremos (`p.ax0/ax1`, caras `p.pivots`)
  entran `ORG.pinE` en agujeros cerrados en gota de bloques de pivote
  (`D.org.blocks`: de pared, con `s` = ±1, o `mid` entre celdas). Montaje:
  ranura desde +Y de `pinE − lip` + embocadura a 45° en planta; el canal del
  eje en el carril está abierto hacia +Y (la tapa interior se desliza). Los
  agujeros y ranuras se restan a toda la tapa (el pivote sobresale de zp1).
  Pozos para el dedo (`D.org.wells`) dentro de la huella de cada tapa
  interior y del interior (en octógono se corren hacia el centro); las
  celdas que pisan (`c.wells`) se recortan con un divisor
  alrededor y su fondo inclinado se hace sin la muesca y luego se resta.
  Ranura de desacople `O.gap` (1 línea) entre divisores/carriles y la pared,
  de zp1 a zi − 0.6; las esquinas de celda contra la pared, en ángulo recto.
  En octógono, lo que queda fuera de la cuerda a la altura del eje se
  rellena (`cell.lim`). Para probar choques usa `_orgNoSnap` (la
  interferencia del resalte de clic es a propósito). Tapas interiores
  agrupadas por firma (engine.js): si añades algo que distinga dos tapas
  (pozos ajenos, muescas), inclúyelo en la firma o se reutilizará la geometría
  equivocada.
- **Orejas anti‑warping** (`earsDetached`): separadas de la huella de las
  dos primeras capas por `max(0.4, lw)` y unidas con 3 puentes de 1 capa
  perpendiculares al contorno. No las fundas con la pieza.
- **Calibración parcial**: `calibPlan(P, { only: [ids] })` o `{ onlyKeys }`;
  `applyResults` devuelve `retestIds` (probetas fuera de rango) y la UI
  genera el test solo con esas.
- `frustum(a, z0, b, z1)` es una ENVOLVENTE CONVEXA: solo para secciones
  convexas (offsets de `rrOffset`). Para chaflanes de formas cualquiera
  (alojamientos de insertos) usa `steppedChamfer`. El frustum se comía la
  cubierta entre alojamientos.
- **Línea de contracción** (`criticalLayers` → ranura en V `vGroove`): la V
  se coloca en la caída de área (fondo → paredes). Con fondos/techos finos
  (modo ahorro) la línea cae a ~1 mm de la cama: la V se sube lo justo para
  no tocar el chaflán del borde (+1 capa) si la línea sigue dentro de ella.
  Profundidad `D.shadowV` = min(0.5, t − 0.9): la pared detrás conserva 2
  líneas.
- **Sin soportes**: toda pieza plana debe quedar con puentes ≤ `D.maxBridge`
  (10 mm, límite de Orca/Bambu). La tapa se imprime boca abajo: cualquier
  cavidad de su cara superior es un techo → `limitBridges` en pattern.js.
- **Mecánica completa**: cualquier recorte global de la base o la tapa
  (pie de apilado, biseles, envolventes) puede comerse bisagras y cierres SIN
  provocar colisiones, así que las pruebas de choque no lo ven. `mechChecks`
  exige que todo lo que la mecánica tiene por fuera de la banda esté entero.
  El apilado ya no recorta la base por fuera: la pared baja recta.
- **Espesor mínimo**: nada por debajo de 2 líneas. Las membranas cortas en
  un sentido y largas en otro (techo del hueco del barril bajo la ranura de
  la junta, `D.mem` ≥ 1.2 mm) solo se ven en el corte longitudinal adecuado:
  `thicknessChecks` corta en XY, YZ y XZ. El laberinto doble solo se usa si
  cabe con paredes y puntas de lengüeta de 2 líneas; si no, una ranura.
- **Agujeros verticales de piezas sueltas** (cierre, tapones) salen más
  pequeños: usa `D.latchBoreD` / `D.capHoleD`, que ya incluyen `D.holeComp`.
  Los agujeros de base y tapa son horizontales (teardrop) y no la llevan.
- Clases de tamaño en `MECH` (params.js): XS < 50 mm, S < 90, M < 200, L.
  Las cotas de la mecánica que dependen de la clase (`rkWall`, `rlWall`, `tl`,
  `hGap`, `hh`, `bandHlMin`, `kd0`) se leen con `Mx.x ?? valor de S/M/L`.
- **Montaje real**: un pasador/tapón no solo debe no solaparse; tiene que
  poder llegar a su sitio. Ver `tests/lib/assembly.mjs` (`pinChecks`). La
  cabeza del pasador impreso va en `headSide` (params.js); con `side > 0` la
  instancia se gira 180° en Z.
- Evita importaciones circulares (p. ej. `pattern.js` ↔ `engine.js`): las
  utilidades compartidas van en `seal.js` o `geo.js`.

## Guía de interfaz (obligatoria): los diez mandamientos

Texto completo, variables y lista de comprobación en
`docs/GUIA-INTERFAZ.md` (estilo de las *Human Interface Guidelines* de
Apple). Todo cambio de `index.html`, `style.css`, `main.js`, `viewer.js` o
de los textos del `SCHEMA` debe cumplirlos:

1. **La caja es la protagonista**: el visor manda; paneles neutros; lo que
   flota sobre el visor es translúcido.
2. **Claro antes que denso**: tipografía del sistema, 13 px (mín. 12),
   frase normal, jerarquía por tamaño y peso; nunca MAYÚSCULAS ni
   monoespaciada (salvo el registro); palabras del usuario, no del motor.
3. **Un solo acento** (naranja: lo interactivo y la acción principal);
   verde/ámbar/rojo solo para estado y siempre con texto; contraste AA;
   colores solo como variables de `:root`.
4. **Solo lo que aplica**: buen valor por defecto, `when` para lo que
   depende de otra opción (se oculta, no se pone en gris), `adv` para lo
   avanzado.
5. **Se toca y se ve**: sin botón «Aplicar»; deslizador + campo son el
   mismo valor; la interfaz nunca se bloquea.
6. **El usuario manda**: deshacer/rehacer siempre (`remember()` ANTES de
   cambiar `state.P`); lo reversible no pregunta (se hace + «Deshacer» en
   la notificación); lo irreversible se confirma con `sheet()` y el verbo
   en el botón. **Prohibido `alert`/`confirm`/`prompt`**.
7. **Lo de siempre, donde siempre**: interruptor = sí/no, menú = una entre
   varias, deslizador + campo = número, botón con verbo («…» si pide algo
   más); mismo nombre para lo mismo en panel, avisos, LEEME y archivos.
8. **Informar sin interrumpir**: `toast()` para lo puntual, avisos junto al
   resultado, mensajes que dicen qué pasa y qué hacer; lo que hay que
   comprar o cortar, con cantidades, en el resumen y el LEEME.
9. **Para todo el mundo**: teclado completo con foco visible, nombre
   accesible en cada control, 44 px con el dedo, claro/oscuro, movimiento
   reducido, sin desplazamiento horizontal en 390 px.
10. **Oficio y rendimiento**: rejilla de 4 px, radios 6/10/14, animaciones
    de 150–250 ms que expliquen un cambio; render bajo demanda; **todo lo
    que se crea se libera** (diálogos al cerrarse, temporizadores, URLs,
    geometrías; historial con tope).

Cifras en los textos: `fmtN`/`mm()`/`dims()` de main.js (coma decimal y
espacio duro antes de la unidad). `tests/ui-guide.test.mjs` y
`tests/ui.e2e.mjs` (asidero `window.__rugged`) comprueban estos puntos; un
ajuste nuevo debe pasar ambos.

## Criterios de validación (los comprueba el barrido)

1. Piezas con malla válida y un solo sólido (la junta dividida admite 2 tiras).
2. Caja cerrada sin interferencias; apertura 0–180° y cierres 0–80° sin choques.
3. Inclinada: mecánica intacta y sin voladizos > 50° sin soporte.
4. Apilable: asienta sin interferencia y bloquea ±0.6 mm en X e Y, también
   con bases poco profundas.
5. Insertos: sin interferencia con la caja ni con el contenido.
6. Pasadores y tapones: no se solapan con la caja, la tapa abre sin tocarlos,
   tienen camino de montaje libre y el filamento entra recto.
7. Piezas planas: ningún puente/voladizo más ancho que `maxBridge` y ninguna
   ménsula a 90° en el borde (zona sin apoyo que toca el contorno de la capa;
   p. ej. la tapa en relieve, impresa boca abajo, debe apoyar todo su contorno).
8. Mecánica completa en base y tapa (`mechChecks`).
9. Espesor mínimo de 2 líneas (0.9 mm) en base y tapa, lengüetas incluidas
   (`thicknessChecks`: cortes XY, YZ por la mecánica y XZ por la banda).
10. Piezas sueltas: agujero del cierre con holgura + `holeComp` y chaflán en
   las dos caras; tapón tipo pinza (`printFitChecks`).
11. Rendimiento (`perf.test.mjs` + `mempeak.test.mjs` + `budget.test.mjs`):
   la memoria WASM no crece al reconstruir y su pico por construcción cumple
   su presupuesto, A + B = build completo, la vista rápida da piezas
   válidas, las cachés (base, tapa, ayudas) devuelven lo mismo que
   recalcular y cada función cumple su presupuesto de tiempo.
12. Test de holguras (`calib.test.mjs`): universal = siempre 8 probetas;
   "esta caja" se adapta y su valor central es la cota real; probetas
   válidas, en la orientación de su unión, sin voladizos > 50°, < 30 g; los
   resultados (B/F conservan el diámetro medido, P desplaza Ø3/Ø5) se
   aplican y persisten. El barrido incluye perfiles extremos, también en
   cajas inclinadas.
13. Compartimentos, en la tapa, en la base o en las dos
   (`organizer.test.mjs` + casos del barrido): celdas ≥ lo pedido, cerrada
   sin solapes con tapa/base/inserto/otras tapas interiores, cada tapa
   interior abre 0–95° sin chocar, clic del eje y del faldón, pozos dentro
   del interior, sin voladizos > 50°, cabe en la cama, sin piezas sueltas.
14. Modo ahorro (casos "ahorro" y "nervado" del barrido): mismos criterios
   1–13 con pared, fondo y techo mínimos o piel nervada.
15. Traba magnética: alojamientos del diámetro y alto pedidos en cuerpo y
   tapa interior, libres para el imán, con nervios, pared ≥ 2 líneas y piel
   bajo el imán; caras a 0.4 mm; reparto simétrico; sin resaltes de clic.
16. Junta de cordón: sin pieza de junta, compresión 10–40 %, llenado
   ≤ 95 %, longitud a cortar coherente con el perímetro.
17. Interfaz (`ui-guide.test.mjs`, `ui.e2e.mjs`): los diez mandamientos
   medibles, y ni el visor, ni el documento, ni la memoria de JS crecen
   tras 24 cambios completos.

## Repositorio

Git, rama `main`, remoto `origin` en GitHub
(`Parra0713/parametric-rugged-box`). Mensajes de commit en español, de una línea, cortos y en tono
natural, sin líneas Co-Authored-By ni enlaces a sesiones. No se
suben `node_modules/`, `scratch/`, `logs/` ni archivos de entorno o claves
(ver `.gitignore`). `dist/rugged-box.html` SÍ se sube (es la app lista para
usar): compílala (`npm run build`) en el mismo commit que cambie `src/`.
