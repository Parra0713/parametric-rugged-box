# Rugged Box — generador paramétrico de cajas de alta resistencia (FDM)

Aplicación web local que genera, en tiempo real, cajas tipo *rugged box*
100 % imprimibles: base, tapa con bisagra, cierres autobloqueantes, junta
hermética en TPU y pasadores, sin tornillería.

![Caja abierta](docs/captura-abierta.png)

---

## Fase 1 — Tecnología elegida y por qué

| Requisito | OpenSCAD | CadQuery | JSCAD | **three.js + manifold‑3d (WASM)** |
|---|---|---|---|---|
| Vista en tiempo real | ✗ (render CGAL en segundos/minutos) | ✗ (Python + OCCT, sin UI propia) | ~ (CSG lento en JS puro) | **✔ 100–300 ms por reconstrucción** |
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
* **Línea de contracción ("Benchy hull line"):** se produce cuando el tiempo
  de capa cae de golpe (fondo macizo → solo paredes) y la capa se enfría y
  contrae distinto. Se evita con un **chaflán interior de 45°** suelo/pared
  (el área por capa disminuye gradualmente), la banda con **chaflán
  inferior de 45°** (misma idea arriba) y una **ranura de sombra en V** que
  hace coincidir cualquier marca residual con una arista intencionada.

![Sección](docs/seccion.png)

---

## Fase 2 — Funciones

* Medidas **interiores** como entrada; el panel muestra el `inner_corner_radius`,
  profundidades exactas y holguras recomendadas para insertos (botón *Copiar
  JSON*, y `interior.json` dentro del ZIP).
* Bisagras y cierres adaptativos (clase S/M/L automática o forzada).
* Junta TPU / laberinto / lengüeta simple.
* Tapa: liso, hexagonal, estriado, reforzado cruzado + **SVG propio**, en
  grabado (recomendado) o relieve.
* Pies **Gridfinity** opcionales (desactivados por defecto).
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

Requiere Node.js ≥ 20.

```bash
npm install
npm run dev      # servidor local con recarga en caliente → http://localhost:5173
npm test         # pruebas geométricas (interferencias, apertura, junta, cama)
npm run build    # regenera dist/rugged-box.html
```

### Flujo de trabajo

1. Define el **espacio interior** que necesitas.
2. Revisa las tarjetas de la derecha: interior final, mecánica elegida,
   junta y orientación en la cama (elige tu impresora en *Impresora*).
3. Personaliza la tapa o importa un SVG (formas con relleno; los trazos se
   convierten con su grosor).
4. **Exportar todo (.zip)** → abre las placas en tu slicer. Las piezas ya
   vienen orientadas para imprimir sin soportes.

### Impresión recomendada

| Pieza | Material | Notas |
|---|---|---|
| Base / tapa | PETG, ASA o PLA | 0.2 mm, 4–6 perímetros, 15–25 % gyroid. La tapa, con la cara decorada sobre la cama. |
| Cierres | PETG (mejor que PLA: más elástico) | Acostados, como se exportan. 5+ perímetros. |
| Pasadores | PETG / PLA | Acostados sobre la cara plana, 100 % de relleno. |
| Junta | TPU 95A | Lenta, 100 % de relleno. |

---

## Estructura

```
index.html              interfaz
src/main.js             parámetros, panel de medidas, exportación
src/viewer.js           vista 3D (three.js, render bajo demanda)
src/engineClient.js     comunicación con el worker ("último pedido gana")
src/worker.js           hilo de geometría
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
tests/                  pruebas geométricas en Node
```

Licencia MIT.
