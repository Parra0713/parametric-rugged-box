# Rugged Box — generador paramétrico de cajas de alta resistencia (FDM)

Aplicación web local que genera, en tiempo real, cajas tipo *rugged box*
100 % imprimibles: base, tapa con bisagra, cierres autobloqueantes, junta
hermética en TPU y pasadores, sin tornillería.

![Caja abierta](docs/captura-abierta.png)

![Cierres empotrados](docs/captura-cierres.png)

![Impresión inclinada con aletas](docs/impresion-inclinada.png)

---

## Fase 1 — Tecnología elegida y por qué

| Requisito | OpenSCAD | CadQuery | JSCAD | **three.js + manifold‑3d (WASM)** |
|---|---|---|---|---|
| Vista en tiempo real | ✗ (render CGAL en segundos/minutos) | ✗ (Python + OCCT, sin UI propia) | ~ (CSG lento en JS puro) | **✔ ~90 ms vista rápida, modelo completo al soltar** |
| Importar SVG directo | ~ (`import()`, sin control de trazos) | ~ (vía librerías extra) | ~ | **✔ SVGLoader: rellenos, agujeros y trazos** |
| Memoria / CPU | Alto en booleanas | Alto (OCCT ~200 MB) | Medio | **Bajo: núcleo C++ en WASM de 540 KB, memoria liberada en cada ciclo** |
| Mallas siempre válidas | ~ | ✔ (B‑rep) | ✗ (errores frecuentes) | **✔ manifold garantiza mallas cerradas** |
| Instalación | Programa aparte | Python + conda | Node | **Ninguna: un único `.html`** |

**manifold‑3d** es el motor CSG que también usan OpenSCAD (backend *Manifold*,
10–1000× más rápido que CGAL) y Blender; compilado a WebAssembly corre en un
*Web Worker*, de modo que la interfaz nunca se congela. La vista usa
three.js con **render bajo demanda** (0 % de GPU con la vista quieta) y el
cliente aplica la política **"último pedido gana"**: al arrastrar un
deslizador nunca se acumulan cálculos atrasados.

**Dos pasadas por cada cambio** (v6.5):

1. **Vista rápida** (~90 ms en una caja normal): dos hilos construyen a la
   vez la mitad de las piezas cada uno (base | tapa), con la mitad de
   segmentos en las curvas y sin ranuras de sombra ni ayudas de impresión.
2. **Modelo completo** cuando dejas de tocar los controles ~0,3 s, en un
   tercer hilo, para que el cálculo largo de las cajas grandes inclinadas
   (aletas y soportes, segundos) nunca frene la vista rápida.

Además: la base, las ayudas de impresión y el análisis de capas se guardan
en caché (cambiar el patrón de la tapa no recalcula los soportes de la base)
y la memoria WASM se libera de verdad en cada ciclo.

### Soluciones mecánicas (resumen de la investigación)

* **Bisagra de nudillos alternados con el eje a la altura de la punta de la
  lengüeta.** Un punto a altura *c* sobre el eje se desplaza *c·θ* en
  horizontal al abrir; con el eje en la punta, la lengüeta sale casi vertical.
  El término de segundo orden *a(1−cos θ)* lo absorbe un chaflán de 0.6 mm en
  la ranura. Verificado: 0 mm³ de interferencia de 0° a 180°.
* **Pasadores según tamaño (mecánica adaptativa):**
  *S* (< 90 mm) → filamento 1.75 mm + tapones impresos (un filamento extruido
  no tiene uniones entre capas y resiste ~3× más que un pasador impreso de
  igual diámetro); *M/L* → pasador impreso **acostado** (capas a lo largo del
  eje; impreso de pie se parte por la unión entre capas, 40–60 % más débil),
  con cara plana en "D" y punta partida con dientes que flexionan en el plano
  XY. Diámetro, radio de nudillo, número de bisagras/cierres y vuelo de banda
  escalan con la clase.
* **Cierre de gancho autobloqueante:** el pivote está por dentro de la cara de
  la banda, así que la reacción de la junta genera un par que lo **cierra**
  contra su tope; abrirlo exige comprimir más la junta (barrera de energía).
  Se imprime de lado: la flexión de la placa ocurre dentro de cada capa.
* **Sellado:** lengüeta y ranura (*tongue & groove*) con junta TPU 95A
  dimensionada con las reglas de juntas estáticas: **compresión 25 %** y
  **llenado del alojamiento ≤ 85 %** (el elastómero es casi incompresible).
  El contacto cara contra cara de tapa y base es el tope duro que fija esa
  compresión. Alternativas: laberinto doble o lengüeta simple.
* **Tolerancias:** 0.25 mm radial en ajustes deslizantes, 0.4 mm axial entre
  nudillos, agujeros horizontales en *teardrop* (45°) y todos los voladizos
  ≤ 45° → **sin soportes** en ninguna pieza.
* **Línea de contracción ("Benchy hull line") — ataque en 4 frentes.**
  Causa (Prusa Knowledge Base y foros Bambu/Prusa): en la transición de
  relleno macizo a solo paredes el tiempo de capa cae de golpe; el último
  macizo se contrae tirando de los perímetros y la capa siguiente se imprime
  más caliente. Aparece justo encima del fondo macizo.
  1. **Gradiente geométrico:** chaflán interior de 45° suelo/pared y
     techo/pared; banda y bloques con chaflanes de 45° (el área por capa
     cambia gradualmente).
  2. **Desacople:** paredes = número entero de líneas de extrusión (sin
     relleno ni *gap fill* pegado al perímetro exterior) y espesores
     horizontales = capas enteras.
  3. **Detección y ocultación:** el programa corta la pieza capa a capa en su
     orientación de impresión, localiza las caídas de área > 40 % y coloca
     una ranura de sombra en V exactamente en esa altura (en la base y la
     tapa). El panel muestra cada altura crítica y cómo quedó resuelta.
  4. **Ruptura visual + ajustes de slicer:** nervios de esquina y, en el
     `LEEME.txt`, perímetro exterior primero, flujo de macizo 95 % y tiempo
     mínimo de capa.
* **Cierres empotrados y cortos:** el barril se aloja en un hueco local bajo
  la ranura de la junta y el cierre queda al ras de dos mejillas; el retén de
  la tapa es una barra-puente entre ellas. ~25 % más corto que la v1.
* **Mecánica siempre en el lado largo** y reparto adaptado a la longitud
  disponible (número y ancho de cierres/bisagras).
* **Impresión en diagonal o inclinada (diseño diferencial):**
  - Si cabe girada en Z, se coloca en diagonal y se añaden **orejas** de 2
    capas en las esquinas (donde empieza el despegue por contracción).
  - Si solo cabe inclinada, se **prefieren 45°**: fondo y paredes quedan en el
    límite de voladizo imprimible sin soporte.
  - **Bisel integrado y simétrico:** el corte de contacto se convierte en un
    chaflán del diseño aplicado a las **cuatro** aristas inferiores (base) o
    superiores (tapa) a la misma distancia: la pieza queda simétrica y el
    bisel también se ve en el ensamblaje. Se elige el eje de inclinación
    que deja el apoyo en los lados cortos (sin bisagras ni cierres).
  - **Corte diagonal de contacto:** la arista que tocaría la cama se bisela
    con un plano paralelo a ella, hasta la franja más ancha que no se acerque
    a la cavidad a menos de un espesor de pared (en una tapa de 250×170:
    ~5 mm × 190 mm ≈ 930 mm² de apoyo en vez de una línea).
  - **Aletas de soporte** (inspiradas en las *support fins* de Slant3D /
    M. Trahan y el soporte perimetral con puentes de KNIN): láminas de 2
    líneas perpendiculares al eje de inclinación, con celosía a 45°, pie de
    2 capas, holgura con la pieza y **dientes de 1 línea cada 6 mm** como
    único contacto. Solo llegan un poco más allá del centro de masa: las
    caras a 45° se sostienen solas y el material de la aleta crece con el
    cuadrado de su altura. Resultado: ~3–5 % del material de una cuña maciza.
  - La junta TPU se divide en tramos si no cabe entera.
* **Soportes en el STL y dentro de la cama:** por defecto las ayudas se
  exportan en el mismo STL que la pieza (`*_con_soportes.stl`) y la pieza se
  centra sola en su placa; las orejas se recortan al área imprimible.
  Ajustes mínimos: modo (automático / sin aletas / desactivado), separación
  y alcance de las aletas, paso de los dientes y holgura.
* **Contenedor a medida desde el calco SVG:** sube el contorno de tu pieza
  (SVG 1:1, respeta mm/cm/in/px). El programa ajusta el interior al
  rectángulo de área mínima (+ holgura) y calcula cuánto se pueden recortar
  las esquinas sin tocarla.
* **Esquinas recortadas (octógono alargado):** toda la caja (paredes, banda,
  junta, tapa, patrón, apilado, Gridfinity) se genera a partir de la forma
  interior, así que el octógono se propaga a todas las piezas.
* **Optimizador "imprimir plana":** si la caja no cabe plana, busca la
  combinación de menor impacto entre recortar esquinas (gratis si el
  contenido lo permite), banda más fina o pared con una línea menos (nunca
  < 4 líneas ni < 1.6 mm), y la aplica con un clic.
* **Soportes de voladizos detectados capa a capa:** al inclinar, el programa
  corta la pieza cada 0.6 mm y marca lo que sobresale más de 50° respecto a la
  capa anterior (contando con lo que ya sostienen las aletas). Solo ahí genera
  columnas en rejilla de 2 líneas con interfaz maciza de 2 capas, pie de 2
  capas y separación de 1 capa con la pieza. Bisagras y cierres intactos son
  autoportantes a 45°; lo que sí necesita soporte (p. ej. la cara inferior de
  la banda en el extremo alto) queda cubierto.
* **Apilable (v6.2):** la base de arriba conserva la pared RECTA hasta la
  cama, así que bisagras y cierres quedan intactos (antes el pie de apilado se
  estrechaba con un cono de 45° que se comía hasta el 90 % de la mecánica en
  bases poco profundas). Por debajo lleva un faldón con cara interior a 45° y
  un canal oculto (techo = puente de 1.9 mm) donde entra el marco de la tapa
  de abajo, y un pie con ranuras para sus nervios. La tapa tiene un bisel de
  45° en el borde que sube hasta el marco: asiento cónico que centra y bloquea
  en X e Y. Nervios paralelos al lado largo con paso ≤ 0.8 × el puente máximo
  (la piel puentea ≤ 8 mm, por debajo de los 10 mm a partir de los que
  Orca/Bambu ponen soporte).
* **Clase XS (ultrapequeña, < 50 mm exteriores):** mecánica a escala sin
  bajar de los mínimos de impresión: nudillo con 1.6 mm de pared alrededor
  del agujero (3.5 líneas), orejeta 1.3 mm, placa de cierre 1.6 mm, cierre de
  7 mm, banda de 1.8 mm, lengüeta de 1.8 mm. En una caja de 20×20: cierre un
  25 % más corto (12.6 mm frente a 16.8), 3 mm menos de fondo exterior y la
  base y la tapa mínimas ~1 mm más bajas que con la clase S. Se elige sola o
  en Mecánica → Robustez.
* **Espesor mínimo de 2 líneas (v6.3):** el techo del hueco del barril del
  cierre, bajo la ranura de la junta, tiene ≥ 1.2 mm (antes 0.5 mm: se
  transparentaba y podía partirse); el laberinto doble solo se usa si caben
  paredes y lengüetas de 2 líneas (si no, una sola ranura); el cartabón de la
  bisagra de la tapa no deja aletas finas con el bisel de apilado. Una prueba
  corta base y tapa en tres direcciones buscando zonas de menos de 0.9 mm.
* **Ajuste del filamento en piezas sueltas (v6.4):** los agujeros verticales
  salen 0.1–0.3 mm más pequeños al imprimir. El cierre y los tapones suman una
  **compensación de agujeros** ajustable (0.15 mm por defecto, Impresión →
  Impresora); el agujero del cierre lleva chaflán de 0.4 mm en las dos caras
  (la de la cama anula la pata de elefante) y el tapón es **tipo pinza**:
  agujero 0.2 mm menor que el filamento con una ranura lateral que se abre y
  agarra sin depender de la precisión exacta.
* **Sin soportes en todas las piezas planas:** un limitador de puentes
  añade nervios finos a cualquier celda del patrón de la tapa (grabado o
  relieve) más ancha que el puente máximo (ajustable, 10 mm por defecto).
* **Montaje real de pasadores (v6.1):** tapones Ø4 para el filamento; el eje
  del cierre baja lo justo para que tapón o cabeza del pasador libren la banda;
  con filamento el eje queda fuera de la cara de los nervios de esquina (entra
  recto); las cabezas de las bisagras miran a los extremos y cada pasador del
  cierre entra por el lado del eje que tiene recorrido libre; los nervios de
  esquina dejan ≥ 6 mm para colocar tapones; con 3 bisagras impresas la
  central tiene hueco para meter su pasador.
* **Insertos interiores:** siguen la forma exacta del interior (también el
  octógono y el chaflán del suelo) con holgura ajustable. Solo paredes de
  2 líneas, cubierta y nervios cada ~40 mm: huecos por debajo (~10 % del
  material de un bloque macizo). Con el calco SVG del contenido se generan
  **alojamientos pasantes** (el objeto apoya en el fondo de la caja, sin gastar
  material en fondos) con pared propia, chaflán de entrada y **huecos para los
  dedos** colocados automáticamente en los bordes del eje menor del objeto
  (diámetro y posición ajustables). Inserto en blanco opcional para la tapa.
  Se imprimen con la cubierta sobre la cama.
* **Varios objetos con acomodo automático:** añade todos los calcos que
  quieras (con cantidad). Se acomodan solos para la caja más pequeña:
  giros de 90/180/270° (encaje cabeza con cola), colocación por gravedad,
  pared mínima entre huecos configurable (rigidez) y huecos para dedos que se
  comparten entre objetos vecinos. Entre disposiciones de área parecida
  prefiere la que deja la caja **plana en la cama**. La caja se ajusta al
  acomodo o, en modo manual, el acomodo se hace dentro de tus medidas.
* **Insertos con la misma lógica de cama** que la caja: diagonal + orejas, o
  inclinados con bisel simétrico, aletas y soportes de voladizos.
* **Interfaz por pasos:** pestañas Caja → Contenido → Tapa → Mecánica →
  Impresión, ayudas de una línea y **modo experto** para los ajustes finos.
  El panel derecho empieza por un resumen (cabe plana/diagonal/inclinada,
  placas, material, avisos) y deja el detalle en secciones plegables.
* **Registro y pruebas:** tarjeta "Registro" en la interfaz (descargable en
  JSON) y barrido de regresión de 20 a 380 mm (`npm run test:sweep`) que
  comprueba integridad de piezas, colisiones, mecánica tras el bisel,
  voladizos, apilado, insertos, montaje de pasadores y tapones, y puentes.
* **Robustez en cajas pequeñas:** la mecánica tiene longitudes mínimas
  (nudillo ≥ 4 mm, cierre ≥ 6 mm); los nervios de esquina ceden longitud o
  se omiten antes que recortar bisagras y cierres.

![Sección](docs/seccion.png)

---

## Fase 2 — Funciones

* Medidas **interiores** como entrada, con profundidad propia para base y
  tapa (o **tapa mínima** para objetos a ras del borde); el panel muestra el `inner_corner_radius`,
  profundidades exactas y holguras recomendadas para insertos (botón *Copiar
  JSON*, y `interior.json` dentro del ZIP).
* Bisagras y cierres adaptativos (clase XS/S/M/L automática o forzada).
* Junta TPU impresa / **cordón de filamento TPU de 1,75 mm** (v7.3: sin
  imprimir la junta) / laberinto / lengüeta simple.
* **Contenido en cualquier mitad** (v7.3): la base y la tapa llevan, cada
  una, nada, un inserto en blanco, un inserto con huecos a medida o
  compartimentos con tapas interiores (traba de clic o **magnética**).
* **Deshacer / rehacer** de cualquier cambio (Ctrl/⌘+Z).
* Tapa: liso, hexagonal, estriado, reforzado cruzado, **sci‑fi circuito**
  (semilla editable) y **sci‑fi radial** + **SVG propio**, en grabado o
  relieve.
* **Gridfinity:** placa base interior (los bins van dentro; botón para ajustar
  el interior a celdas enteras) o pies bajo la caja.
* **Apilable:** faldón y canal bajo la base que encajan en el marco con bisel
  de 45° de la tapa; la cara superior se imprime sobre nervios paralelos
  (puentes ≤ 8 mm, sin soportes) y la mecánica no se toca.
* Nervios de esquina y banda fina proporcionada.
* **Optimizador de cama:** recta → 90° → **ángulo diagonal mínimo** → si no
  cabe plana, inclinación mínima sugerida (con soportes). Empaqueta todas las
  piezas en placas.
* Vista montada con animación de apertura (cierres y tapa sobre sus ejes
  reales), explosionada, placas de impresión, corte de sección y volumen
  interior.
* Exportación: STL por pieza, STL por placa, `LEEME.txt` con ajustes de
  impresión y montaje, parámetros e interior en JSON.

---

## Fase 3 — Uso

### Opción A: sin instalar nada

Abre **`dist/rugged-box.html`** con doble clic (Chrome, Edge o Firefox).
Todo el programa (incluido el motor WASM) está dentro de ese archivo y
funciona sin internet.

### Opción B: desarrollo

Requiere Node.js ≥ 20 (en Windows: `winget install OpenJS.NodeJS.LTS`).

```bash
npm install
npm run dev      # servidor local con recarga en caliente → http://localhost:5173
npm test         # geometría, cama, montaje real, rendimiento y guía de interfaz
npm run test:ui  # interfaz en un navegador real (tras npm run build; necesita Playwright)
npm run test:assembly  # mecánica completa, espesor ≥ 2 líneas, pasadores montables, puentes ≤ 10 mm, apilado
npm run test:sweep   # barrido de 20 a 380 mm con registro en logs/
npm run build    # regenera dist/rugged-box.html
```

### Flujo de trabajo

1. Define el **espacio interior** que necesitas.
2. Revisa las tarjetas de la derecha: interior final, mecánica elegida,
   junta y orientación en la cama (elige tu impresora en *Impresora*).
3. Personaliza la tapa o importa un SVG (formas con relleno; los trazos se
   convierten con su grosor).
4. **Exportar todo** → abre las placas en tu laminador. Las piezas ya
   vienen orientadas para imprimir sin soportes, y el `LEEME.txt` dice qué
   más hace falta (imanes, cordón de TPU, filamento para pasadores).

### Impresión recomendada

| Pieza | Material | Notas |
|---|---|---|
| Base / tapa | PETG, ASA o PLA | 0.2 mm, 4–6 perímetros, 15–25 % gyroid (modo ahorro: ver su ficha). La tapa, con la cara decorada sobre la cama. |
| Cierres | PETG (mejor que PLA: más elástico) | Acostados, como se exportan. 5+ perímetros. |
| Pasadores | PETG / PLA | Acostados sobre la cara plana, 100 % de relleno. |
| Junta | TPU 95A | Lenta, 100 % de relleno. Con «cordón» no se imprime: se corta filamento TPU. |
| Tapas interiores | PETG / PLA | Cara exterior sobre la cama, 3+ paredes. |

---

## Modo ahorro de material (v6.9 – v7.0)

**Caja → Paredes → Modo ahorro de material** y **Diseño del modo ahorro**:

| Diseño | Qué hace |
|---|---|
| **Mínimos** (mismo diseño) | Baja a los mínimos seguros todo lo que es masa: pared de 4 líneas (≥ 1.6 mm), fondo y techo de 5 capas (6 en cajas > 190 mm), banda ≤ 2.4 mm con ≥ 2 líneas a cada lado de la ranura, sin nervios de esquina, patrón grabado con piel mínima (0.9 mm en capas enteras) bajo las celdas, inserto y organizador finos. |
| **Nervado ligero** (diseño propio) | Piel de **3 líneas** (el mínimo estanco) + **nervios verticales** de 2 líneas que llenan el vuelo de la banda: la envolvente no cambia y los nervios sostienen la banda. Separación = la mayor que da la rigidez de la pared de 4 líneas, con tope para que la piel entre nervios no sea más flexible que la pared original en su vano. La tapa interior del organizador baja a 5 capas (sus faldones hacen de nervios). |
| **Nervado rígido** (diseño propio) | Igual, con los nervios tan juntos como haga falta para igualar la rigidez de la pared **normal** (la caja sin ahorro). |

En todos: bisagras, cierres, pasadores, junta, lengüetas, holguras
calibradas, organizador e impresión sin soportes **no cambian** (mismos
criterios del barrido). Los nervios nunca van en las esquinas, frente a
bisagras y cierres ni en el camino de pasadores y tapones.

**Comparativa** (`npm run eco:compare`; gramos de laminador capa a capa con
los ajustes recomendados de cada variante, rigidez a flexión de la pared
frente a la normal, tiempo relativo aproximado):

| Caja | Normal | Mínimos | Nervado ligero | Nervado rígido |
|---|---|---|---|---|
| M 120×80 | 160 g · 100 % rígida | 98 g (−39 %) · 30 % | 87 g (−46 %) · 48 % | 89 g (−44 %) · **104 %** |
| Herramienta + organizador 6×3 + inserto | 506 g | 343 g (−32 %) · 30 % | 309 g (−39 %) · 54 % | 313 g (−38 %) · **104 %** |
| L 260×180 | 527 g | 339 g (−36 %) · 30 % | 305 g (−42 %) · 35 % | 317 g (−40 %) · **104 %** |

Ojo: esa comparativa supone la caja normal laminada con 6 perímetros y 20 %
de relleno. Con un perfil de 2 perímetros y relleno bajo (0.24 Draft de
Orca para la Mi impresora) las paredes gruesas ya salen casi huecas y el ahorro
real medido en Orca es de ~15 % (herramienta: 330 → 279 g eco, 276 g
nervado); el nervado entonces aporta sobre todo rigidez, no gramos.

**Patrón de la tapa en ahorro (v7.1)**: el grabado se mantiene con piel
mínima bajo las celdas (≥ 0.9 mm en capas enteras). Antes pasaba a relieve,
que impreso boca abajo dejaba la cara entera colgando sobre los nervios y el
contorno en ménsula a 90°. El relieve normal ahora apoya todo el contorno en
la cama (margen, bisel y nervios suben con el relieve), la tapa mínima
reserva altura para el chaflán completo de la banda y, en apilable, los
nervios de esquina bajan en chaflán hasta el marco. El barrido comprueba
que ninguna pieza plana tenga ménsulas a 90° en el borde.

La teoría que lo explica: la rigidez a flexión de una pared crece con el
cubo del espesor (t³), así que adelgazar la pared maciza de 2.7 a 1.8 mm la
deja en (1.8/2.7)³ ≈ 30 %. Un nervio aleja material del eje neutro (Steiner)
y recupera esa rigidez con muy poco material: con 3 líneas de piel y nervios
de 0.9 × 2.9 mm cada 7.5 mm la pared vuelve al 104 % gastando menos que la de
mínimos. Reglas de nervios usadas (diseño de piezas de plástico, adaptadas
a FDM): ancho ≈ 50–70 % de la piel (aquí 2 líneas, sin rechupes en FDM),
alto ≤ 3 × piel, hueco entre nervios ≥ 2 × piel. La piel de 3 líneas es el
mínimo que Prusa recomienda para piezas estancas (3–4 perímetros), y la
resistencia de una pieza FDM depende más del número de perímetros que del
relleno.

El inserto ya era un "marco": se imprime boca abajo, hueco y con nervios
interiores (2 paredes, 0 % de relleno); no hay más que quitarle sin perder
la cara de trabajo.

## Rendimiento (v6.9 – v7.0)

* La **tapa también se guarda en caché**: ajustar el contenido, el inserto
  o las ayudas ya no la recalcula (hilo B de ~150 ms a ~15 ms).
* Con 4 núcleos o más, el **modelo completo y la exportación se reparten en
  dos hilos** (~40 % antes al soltar un control).
* El visor pide la **gráfica dedicada** (`powerPreference: 'high-performance'`):
  en equipos con gráfica integrada + dedicada (p. ej. un portátil con dos gráficas)
  ya no se queda en la integrada. La geometría (CSG) no puede ir a la GPU:
  manifold‑3d en WebAssembly es de un solo hilo y sin GPU; por eso el
  paralelismo es entre hilos (vista rápida en 2, modelo completo en 2).
* `npm run test:budget` mide cada función (vista rápida, cambio de tapa,
  cambio de contenido, modelo completo) normalizado a la velocidad de la
  máquina y falla si se pasa de su presupuesto o empeora frente a la línea
  base guardada. Cada función nueva añade su caso.

## Novedades de la v7.3

![Compartimentos con traba magnética en la base y en la tapa](docs/compartimentos-imanes.png)

### Contenido en cualquier mitad

En **Contenido** cada mitad se elige por separado:

| | Nada | Inserto en blanco | Inserto con huecos | Compartimentos |
|---|---|---|---|---|
| **La base lleva** | ✔ | ✔ | ✔ | ✔ (nuevo) |
| **La tapa lleva** | ✔ | ✔ | ✔ (nuevo) | ✔ |

Las 16 combinaciones valen: compartimentos arriba y abajo, huecos para una
herramienta en la tapa y tornillería en la base, etc. Los compartimentos de
la base son **el mismo diseño** que los de la tapa girado 180° sobre el
plano de unión: celdas que nacen del suelo, tapas interiores bajo el borde
con el eje en el lado de las bisagras (abren hacia el fondo) y el pozo para
el dedo delante. Al compartir geometría comparten también pruebas: lo que
se verifica para una mitad se verifica para la otra. Los huecos de la tapa
quedan justo encima de los de la base (alojan lo que sobresale).

### Traba de las tapas interiores: clic o imanes

* **Mecánica (clic)**: la de siempre (faldón + resalte con precarga).
* **Magnética**: se indica el **diámetro y la altura del imán** de disco
  (2–20 mm × 0,5–8 mm). Cada punto de cierre lleva dos imanes cara con cara
  a 0,4 mm: uno en un **pilar** del cuerpo junto al borde libre (sobre un
  divisor, o en la esquina si la tapa interior cubre una sola celda) y otro
  en un **resalte** de la tapa interior. Los alojamientos son ciegos, a
  presión, con **6 nervios de aplastamiento** y chaflán de entrada (el
  patrón de los agujeros de imán de Gridfinity): absorben la tolerancia de
  la impresora sin pegamento. Reparto simétrico respecto a la pestaña
  (2–4 por tapa interior según su ancho); el pilar nunca toca la pared
  exterior (queda tras la ranura de desacople) y el pozo para el dedo se
  estrecha lo justo si hace falta. Si el imán no cabe en las celdas, la
  caja avisa y usa el clic. El resumen y el LEEME dicen cuántos imanes
  comprar y cómo comprobar la polaridad antes de meterlos.

### v7.3.1: cantidad de imanes, retén de clic y tapas interiores con ayudas

* **Imanes por tapa interior**: «Automático» pone los sugeridos; también se
  puede elegir de 1 a 6. La sugerencia es una estimación (fuerza de una
  pareja N35 a 0,4 mm frente a una tapa con las celdas medio llenas de
  tornillería) y el resumen la explica. Si los pedidos no caben, lo avisa.
* **Traba mecánica más firme**: además de los resaltes de fricción, el borde
  libre lleva un retén que salta a una muesca de la pared exterior (0,4 mm)
  y queda sin tensión. Solo en las tapas interiores que dan a la pared
  exterior; las de filas intermedias siguen con fricción.
* **Apertura**: nervio de agarre bajo la pestaña, dentro del pozo.
* **Ayudas de cama en las tapas interiores**: orejas si son grandes y, si no
  caben planas, inclinadas con aletas y soportes embebidos.

### Junta de cordón (lo más útil de otras cajas)

Se revisaron los generadores de cajas más usados (ver *Fuentes*) y sus
funciones, comparadas con las de este proyecto:

| Función de otras cajas | Aquí | Decisión |
|---|---|---|
| **Junta con filamento TPU de 1,75 mm** en la ranura (Rugged Storage Box de Whity, Parametric Tough Box) | No existía | **Implementada**: ahorra imprimir TPU (lo más delicado de la caja) y sella mejor que un anillo impreso por capas. |
| Asa | No | Descartada: necesita ~25 mm de alto libre en la base y rompe la impresión sin soportes en cajas bajas (la herramienta usa 30 mm). |
| Tope de apertura de la tapa a 90–110° | No | Descartada: los compartimentos de la tapa piden abrirla 180° para apoyarla plana. |
| Tercera bisagra / más cierres | Sí (automático por tamaño) | Ya estaba. |
| Apilado con enclavamiento, Gridfinity, etiquetas | Sí / sí / no | Etiquetas: ya descartadas antes. |
| Ojal para candado | No | Poco valor frente a su coste en la banda. |

**Cómo se dimensiona** (reglas de junta tórica estática): cordón Ø1,75,
compresión 15–35 % (25 % por defecto) y llenado ≤ 85 % del alojamiento; con
eso la ranura sale de ~2,2 mm de ancho (2–3) y la lengüeta de la tapa
aprieta el cordón contra el fondo. No hay pieza de junta: el resumen y el
LEEME dan la **longitud a cortar** (perímetro del eje de la ranura + 1 %,
para que las puntas queden a tope y comprimidas).

### Interfaz al estilo Apple

Nueva guía obligatoria, **`docs/GUIA-INTERFAZ.md`** («los diez
mandamientos»), basada en las *Human Interface Guidelines*, y la interfaz
rehecha para cumplirla: el visor es el protagonista, tipografía del sistema
en frase normal, un solo acento, **revelación progresiva** (cada ajuste
aparece cuando aplica), **deshacer / rehacer**, notificaciones que no
interrumpen y hojas propias en vez de `alert`/`confirm`, foco visible,
contraste AA en claro y oscuro, objetivos táctiles de 44 px y «reducir
movimiento». `tests/ui-guide.test.mjs` mide lo medible (contraste, textos,
ausencia de diálogos del navegador, liberación de recursos) y
`npm run test:ui` lo comprueba en un navegador real, fugas incluidas.

### Revisión general (fallos encontrados y corregidos)

* **Octógono + una tapa interior por celda**: el pozo para el dedo de las
  celdas de las esquinas mordía la pared en diagonal (dejaba ~0,9 mm). Ahora
  se corre hacia el centro lo justo para quedar dentro.
* **Logo**: cambiar de logo con los mismos parámetros devolvía la tapa del
  logo anterior (la caché de la tapa no miraba su contenido).
* **Tapas interiores casi iguales**: por redondeos de una centésima cada una
  salía como pieza distinta. La cuadrícula va ahora sobre una rejilla de
  0,01 mm y las iguales se agrupan (18 tapas → 9 piezas en la herramienta:
  menos STL que imprimir y menos que calcular).
* **Chaflán interior** con compartimentos: las ayudas de impresión quitaban
  una tira que ya no existía.
* **Memoria, fugas**: 480 reconstrucciones seguidas con todo lo nuevo sin
  crecimiento sostenido; el visor, el documento y el montón de JS quedan
  igual tras 24 cambios completos (se comprueba en cada `test:ui`).
* **Memoria, pico**: no había fugas, pero la memoria de WebAssembly nunca se
  devuelve y cada hilo se quedaba con todo lo intermedio de la caja más
  pesada. Ahora cada pieza y cada etapa liberan lo suyo en cuanto acaban:

  | Modelo completo (un hilo) | v7.2 | v7.3 |
  |---|---|---|
  | Herramienta, tapa interior por celda, inclinada | 375 MB | **145 MB** |
  | La misma con traba magnética | — (453 MB sin optimizar) | **179 MB** |
  | Caja de 205 mm sin compartimentos, inclinada | 90 MB | **21 MB** |
  | Grande inclinada (260 × 180) | 114 MB | **28 MB** |

  `tests/mempeak.test.mjs` lo mide en un proceso nuevo por caja y falla si
  se pasa de su presupuesto.
* **Soportes de voladizos** (cajas inclinadas): mismos soportes, mismo
  volumen, calculados con la mitad de operaciones: de ~2,7 s a ~1,2 s en la
  tapa de la herramienta.

## Compartimentos en la tapa y en la base (v6.8 – v7.3)

**Contenido → La tapa lleva / La base lleva → Compartimentos**: cuadrícula
de compartimentos integrada (terminales, tornillos, fusibles…) con **tapas
interiores** para que, con la caja cerrada (tapa boca abajo), nada se caiga
ni se mezcle. La otra mitad sigue alojando lo que quieras (p. ej. la
herramienta, con el inserto a medida del calco SVG).

* **Columnas × filas**, **tamaño mínimo de celda** y **altura de celda**: si
  no caben, la caja y la tapa crecen solas (se avisa en el registro). Con 0
  la cuadrícula reparte el interior disponible.
* **Tapa interior**: una para todos los compartimentos, una por fila, una
  por compartimento o ninguna.
* **Bisagra de pivotes (v7.2)**: cada tapa interior lleva un eje Ø3 impreso
  en su borde cuyos extremos entran en **agujeros cerrados** de dos bloques
  de pivote (en las paredes o, con una tapa por celda, entre celdas). Abrir y
  cerrar carga el agujero entero, no un clic, así que no se gasta. Se monta
  deslizándola hacia el carril con los pivotes por su ranura: al final saltan
  a su agujero (retén de 0.3–0.45 mm, de la precarga calibrada). Antes eran
  grapas en "C" con la punta en el aire y un clic que con el uso aflojaba.
  Cierre de clic: un faldón entra en cada celda con la holgura deslizante
  calibrada (probeta C) y un resalte con la precarga calibrada (probeta E).
* **Apertura**: en el borde libre de cada tapa interior hay un **pozo para
  el dedo** (bolsillo cerrado, separado de las celdas) y la tapa interior
  asoma sobre su mitad como pestaña: se mete la yema detrás y se tira. En
  celdas demasiado pequeñas para un dedo no se añade.
* **Sin marcas por fuera**: los divisores y carriles quedan separados de la
  pared exterior por una ranura de 1 línea. Fundidos a ella, al contraerse
  tiraban de la pared y marcaban una línea vertical en el exterior (el
  "rechupe" frente a un nervio de las piezas inyectadas).
* **Fondo inclinado** en cada celda para recoger piezas pequeñas.
* Sin soportes: la tapa se imprime boca abajo (celdas, bloques y pozos hacia
  arriba, agujeros en gota, ranuras de montaje con chaflán de 45°) y las tapas
  interiores con la cara exterior en la cama. Las tapas interiores idénticas se exportan una vez
  con su número de copias.
* Se adapta a todo: octógono (las esquinas fuera del giro se rellenan),
  apilable, girada, XS a L e impresión inclinada. `tests/organizer.test.mjs`
  comprueba, en la tapa, en la base y en las dos, con clic y con imanes, que
  todo cierra, que cada tapa interior abre 0–95° sin chocar y que nada
  necesita soportes; y construye las 16 combinaciones de contenido.

## Mejoras de impresión (v7.2)

* **Orejas anti‑warping de retiro fácil** (brim estructurado): la oreja ya
  no toca la pieza; queda separada por una ranura de 1 línea y unida por 3
  puentecitos de 1 capa por oreja. Sigue anclando la esquina y se arranca con
  los dedos (antes quedaba fundida al borde).
* **Encastre del cierre en la base**: el techo del hueco del barril se
  imprimía como un puente de ~14 mm junto a la pared; ahora baja en chaflán
  de 45° desde la pared (con 0.4 mm de holgura al giro del barril).
* **Calibración parcial**: si una probeta queda fuera de rango ("todas
  duras"/"todas flojas"), al aplicar los resultados se genera solo un test
  nuevo con esa(s) probeta(s), centrado en el valor corregido (p. ej. A y B:
  3 g / 12 min en vez de 25 g / 72 min). Y si la caja usa holguras que el
  perfil no ha medido, un botón genera solo esas.

## Calibración de holguras (v6.6)

Las holguras dependen de la **impresora, el material y la orientación** con
la que se imprime cada unión (una cota en XY no sale igual que en Z, ni un
agujero horizontal igual que uno vertical o inclinado). En **Impresión →
Calibración de holguras** se genera un test cuyas probetas reproducen cada
unión **en la misma orientación en que se imprime en la caja**, y el
resultado queda en un **perfil** (p. ej. "Mi impresora · PLA") que se aplica solo a
todas las cajas.

| Probeta | Unión de la caja | Orientación al imprimir | Ajusta |
|---|---|---|---|
| **A** | filamento 1.75 en nudillos y orejetas (XS, S) | agujero horizontal en gota | filamento en bisagra |
| **P3 / P5** | pasador impreso Ø3 y Ø5 (+ pasador de prueba real) | agujero horizontal; pasador acostado | pasador impreso Ø3 / Ø5 (entre ambos se interpola) |
| **F** | bisagras y orejetas de una caja que no cabe plana | agujero inclinado 45° | extra si va inclinada |
| **B** | barril del cierre y tapones pinza | agujero vertical | agujeros verticales |
| **C** | lengüeta (tapa boca abajo) en la ranura (base) | paredes verticales, cota en XY | lengüeta (+ nudillos, inserto, objeto) |
| **d** | marco de apilado de la tapa y pie de la base | primera capa, pata de elefante | apilado |
| **E** | gancho del cierre sobre el retén (útil + cierre real) | útil boca abajo como la tapa: el retén es un puente | precarga del cierre |

* **Universal** (por defecto, ≈ 25 g, ≈ 1 h 15 min): las 8 probetas con
  medidas de referencia que cubren de la caja XS a la L. Se imprime una vez
  por impresora y material y vale para cualquier caja que crees después.
* **Solo esta caja** (≈ 10–28 g): solo las uniones que usa la caja abierta,
  con sus cotas exactas. Si la caja no cabe plana incluye F; si es apilable,
  d.
* El filamento 1.75 hace de **calibre** (±0.02 mm, redondo): con él se separa
  el efecto de la orientación (A horizontal, B vertical, F inclinado) del
  error del propio pasador impreso.
* Todo plano, sin soportes, con números en relieve; el útil E y los marcos
  d ya van orientados como la tapa. **Paso fino** (0.025 mm) para afinar un
  perfil ya calibrado.

Se marca el mejor número de cada probeta ("todas duras" / "todas flojas" si
ninguna sirve: se aplica el extremo y se pide repetir) y **Aplicar
resultados**. Los diámetros medidos se conservan aunque otra probeta cambie
la holgura base (B y F se recalculan). El motor sabe antes de modelar si la
caja se imprimirá inclinada (misma huella que el optimizador de cama) y solo
entonces suma el extra de F a bisagras y orejetas; el cierre, que siempre se
imprime de lado, no lo lleva. Cada valor indica si es *medido*, *deducido*,
*manual* o *por defecto*; se puede editar a mano, tener varios perfiles y
restablecerlos. Las holguras no viajan en el enlace compartido.

No se calibran (y por qué): la compresión de la junta de TPU (es un valor de
diseño, 20–30 %, que se comprueba cerrando la caja) y Gridfinity (sus
holguras las fija el estándar para encajar con cajitas de otros).

Valores de partida y rangos (investigación): ajuste giratorio 0.2–0.3 mm por
lado; deslizante 0.15–0.25 (PLA), 0.2–0.3 (PETG), 0.25–0.35 (ASA); las series
de prueba habituales van de 0.1 a 0.5 en pasos de 0.05; los agujeros
verticales salen más pequeños (sin valor universal: hay que medirlo); juntas
de elastómero al 20–30 % de compresión. Fuentes:
[Sovol](https://www.sovol3d.com/blogs/news/fdm-3d-printing-tolerances-clearances-how-to-design-parts-that-fit),
[Snapmaker](https://www.snapmaker.com/blog/3d-printed-hinges/),
[GoodPrints3D](https://www.goodprints3d.com/blogs/3d/why-do-3d-printed-holes-come-out-too-small-and-how-do-you-fix-them),
[QIDI](https://qidi3d.com/es/blogs/print-lab/3d-printed-snap-fit-joints-clearance-guide),
[Obico/OrcaSlicer](https://www.obico.io/es-ES/blog/tolerance-test-in-orcaslicer-a-comprehensive-guide/),
[Kraiburg TPE](https://www.kraiburg-tpe.com/en/gasket-design-what-really-matters-smart-solutions-tpe).

## Estructura

```
index.html              interfaz
docs/GUIA-INTERFAZ.md   guía de diseño de la interfaz (los diez mandamientos)
src/style.css           variables de diseño y componentes (claro / oscuro)
src/main.js             ajustes, resumen, deshacer/rehacer, exportación
src/viewer.js           vista 3D (three.js, render bajo demanda)
src/engineClient.js     tres hilos de geometría: vista rápida (A + B) y modelo completo (R)
src/worker.js           hilo de geometría
src/engine/merge.js     une las mitades A y B de la vista rápida
src/engine/orgLayout.js compartimentos (tapa y base): distribución, imanes (pura)
src/engine/organizer.js compartimentos: celdas, bloques de pivote, pilares de imán y tapas interiores
src/engine/insert.js    insertos de base y tapa (en blanco o con huecos)
src/engine/calib.js     test de holguras: plan adaptativo, probetas y aplicación de resultados
src/calibProfile.js     perfiles de calibración persistentes (localStorage)
src/engine/params.js    parámetros, esquema de UI y derivación de cotas
src/engine/geo.js       primitivas y gestión de memoria WASM
src/engine/seal.js      ranura, lengüeta y junta
src/engine/hinge.js     bisagras
src/engine/latch.js     cierres, orejetas y retenes
src/engine/pins.js      pasadores impresos y tapones
src/engine/pattern.js   patrones de tapa y SVG
src/engine/gridfinity.js pies Gridfinity
src/engine/engine.js    orquestador
src/bedfit.js           optimizador de cama y empaquetado
src/svg.js              lectura de SVG
src/export.js           STL y ZIP sin dependencias
tests/                  pruebas en Node (geometría, montaje, rendimiento, memoria, guía de interfaz)
tests/ui.e2e.mjs        interfaz en un navegador real (opcional: necesita Playwright)
```

Licencia MIT.

## Fuentes de la investigación

* [Rugged Storage Box, Parametric and Customizable (Whity) — Printables](https://printables.com/model/637028-rugged-storage-box-parametric-and-customizable): junta para filamento de 1,75 mm, asa, topes de bisagra.
* [Gridfinity Rugged Storage Box (Pred) — Printables](https://www.printables.com/model/757297-gridfinity-rugged-storage-box-parametric-and-custo): cierres de apilado, tercera bisagra, asa.
* [Parametric Tough Box — Printables](https://www.printables.com/model/731210-parametric-tough-box): ranura para cordón de TPU.
* [gridfinity-rebuilt-openscad, `gridfinity-rebuilt-holes.scad`](https://git.distrilab.fr/Charavane/gridfinity-rebuilt-openscad/src/commit/f222c262fc06a7adb6b1c7a4ff90869b1d5f79f5/gridfinity-rebuilt-holes.scad): agujeros de imán a presión con nervios de aplastamiento y chaflán.
* [Apple — Human Interface Guidelines: principios de diseño](https://developer.apple.com/design/human-interface-guidelines/design-principles.md).

* [The Benchy hull line — Prusa Knowledge Base](https://help.prusa3d.com/en/article/the-benchy-hull-line_124745/)
* [Layer line at transition between floor and wall — Bambu Lab Forum](https://forum.bambulab.com/t/layer-line-at-transition-between-floor-and-wall/40994)
* [Problem with layer after solid bottom — Prusa Forum](https://forum.prusa3d.com/forum/original-prusa-i3-mk3s-mk3-how-do-i-print-this-printing-help/problem-with-layer-after-solid-bottom)
* Especificación Gridfinity (Zack Freedman, CC‑BY): perfiles de pie y placa base.
* [Forget Trees, Add Fins To Your 3D Prints Instead — Hackaday](https://hackaday.com/2026/09/23/forget-trees-add-fins-to-your-3d-prints-instead/)
* [support-fins (M. Trahan) — GitHub](https://github.com/gittrahan/support-fins/wiki)
* [Stop Using Standard Supports — KNIN Custom (YouTube)](https://www.youtube.com/watch?v=TADeDyIBoBU)
* [Tooltrace — cómo funciona (holguras 0/1.5/3/4.5 mm, huecos de dedo Ø20 mm)](https://www.tooltrace.ai/how-to)
* [Free AI tool auto-generates Gridfinity bins — CNC Kitchen](https://cnckitchen.com/blog/this-free-ai-tool-auto-generates-gridfinity-bins)
* [Gridfinity Cutout Generator (muescas y chaflán de entrada)](https://www.gridfinitylayouttool.com/gridfinity-cutout-generator)
