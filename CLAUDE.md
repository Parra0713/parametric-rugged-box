# CLAUDE.md — Rugged Box

Generador web paramétrico de cajas tipo *rugged box* imprimibles en FDM.
Todo el texto de la interfaz, comentarios y mensajes de commit van **en
español**. Unidades: milímetros y grados.

## Comandos

```bash
npm run dev          # servidor Vite con recarga (http://localhost:5173)
npm run build        # dist/rugged-box.html: UN archivo autocontenido (doble clic)
npm test             # pruebas geométricas + optimizador de cama (~1 min)
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
| `src/engine/hinge.js`, `latch.js`, `pins.js` | Mecánica. |
| `src/engine/pattern.js` | Patrones de tapa, logo SVG, interfaz de apilado. |
| `src/engine/insert.js` | Insertos interiores (en blanco / con alojamientos + huecos para dedos). |
| `src/engine/tilt.js` | Impresión inclinada: bisel de contacto, aletas, detector de voladizos y soportes. |
| `src/engine/engine.js` | Orquestador `build(P, svg, opt)`; ayudas de impresión (`addAids`); registro `D.log`. |
| `src/bedfit.js`, `src/optimizer.js` | Cama: rotación/diagonal/inclinación; optimizador "imprimir plana". |
| `src/content.js` | SVG calcado del contenido (unidades reales, rectángulo mínimo, recorte máx.). |
| `src/main.js`, `viewer.js`, `worker.js` | UI, vista three.js (render bajo demanda), hilo de geometría. |

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
  que NO afecte a la base (si afecta, no lo añadas).
- `P.contentPolys` viaja dentro de `P` hacia el worker (polígonos en el marco
  interno).
- Memoria WASM: todo objeto creado se libera en `cleanup()` al final de
  `build`; no guardes `Manifold`/`CrossSection` entre llamadas.
- Evita importaciones circulares (p. ej. `pattern.js` ↔ `engine.js`): las
  utilidades compartidas van en `seal.js` o `geo.js`.

## Criterios de validación (los comprueba el barrido)

1. Piezas con malla válida y un solo sólido (la junta dividida admite 2 tiras).
2. Caja cerrada sin interferencias; apertura 0–180° y cierres 0–80° sin choques.
3. Inclinada: mecánica intacta y sin voladizos > 50° sin soporte.
4. Apilable: asienta sin interferencia y bloquea ±0.6 mm en X e Y.
5. Insertos: sin interferencia con la caja ni con el contenido.

## Flujo con el PC del usuario

El repo vive en `la carpeta del repositorio` (git local, rama
`main`). Se desarrolla en la nube y se sincroniza con un tar; en el PC se
compila y prueba con `./node_modules/.bin/vite build` y `node tests/...`
(la VM del PC no tiene acceso a npm). Commits con autor Parra0713.
