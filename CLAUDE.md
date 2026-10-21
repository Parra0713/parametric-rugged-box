# CLAUDE.md — Rugged Box

Generador web paramétrico de cajas tipo *rugged box* imprimibles en FDM.
Todo el texto de la interfaz, comentarios y mensajes de commit van **en
español**. Unidades: milímetros y grados.

## Comandos

```bash
npm run dev          # servidor Vite con recarga (http://localhost:5173)
npm run build        # dist/rugged-box.html: UN archivo autocontenido (doble clic)
npm test             # geometría + cama + montaje real (~2 min)
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
| `src/engine/insert.js` | Insertos interiores (en blanco / con alojamientos + huecos para dedos). |
| `src/engine/tilt.js` | Impresión inclinada: bisel de contacto, aletas, detector de voladizos y soportes. |
| `src/engine/engine.js` | Orquestador `build(P, svg, opt)`; ayudas de impresión (`addAids`); registro `D.log`. |
| `src/bedfit.js`, `src/optimizer.js` | Cama: rotación/diagonal/inclinación; optimizador "imprimir plana". |
| `src/content.js` | SVG calcado del contenido (unidades reales, recorte máx. de esquina). |
| `src/packer.js` | Acomodo automático de varios objetos (gravedad sobre rejilla de 1 mm, giros 90/180/270°, huecos para dedos compartibles, prefiere cajas que quepan planas). Pura JS. |
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
- El contenido viaja dentro de `P` hacia el worker: `P.contentObjects =
  [{ polys, notches }]` (acomodado por `packer.js`, marco interno). El motor
  no acomoda: solo recorta huecos y huecos para dedos donde le dicen.
  `P.contentPolys` (un objeto) se mantiene por compatibilidad y pruebas.
- La UI se genera de `SCHEMA` (pestaña `tab`, `adv` = solo modo experto,
  `hint` = ayuda de una línea). No añadas controles a mano en `main.js`.
- Las ayudas de impresión (`addAids`) se aplican a base, tapa e insertos; el
  parámetro `G` describe el contorno y si hay mecánica que proteger.
- Memoria WASM: todo objeto creado se libera en `cleanup()` al final de
  `build`; no guardes `Manifold`/`CrossSection` entre llamadas.
- `frustum(a, z0, b, z1)` es una ENVOLVENTE CONVEXA: solo para secciones
  convexas (offsets de `rrOffset`). Para chaflanes de formas cualquiera
  (alojamientos de insertos) usa `steppedChamfer`. El frustum se comía la
  cubierta entre alojamientos.
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
- Clases de tamaño en `MECH` (params.js): XS < 50 mm, S < 90, M < 200, L.
  Las cotas de la mecánica que dependen de la clase (`rkWall`, `rlWall`, `tl`,
  `hGap`, `hh`, `bandHlMin`, `kd0`) se leen con `Mx.x ?? valor de S/M/L`.
- **Montaje real**: un pasador/tapón no solo debe no solaparse; tiene que
  poder llegar a su sitio. Ver `tests/lib/assembly.mjs` (`pinChecks`). La
  cabeza del pasador impreso va en `headSide` (params.js); con `side > 0` la
  instancia se gira 180° en Z.
- Evita importaciones circulares (p. ej. `pattern.js` ↔ `engine.js`): las
  utilidades compartidas van en `seal.js` o `geo.js`.

## Criterios de validación (los comprueba el barrido)

1. Piezas con malla válida y un solo sólido (la junta dividida admite 2 tiras).
2. Caja cerrada sin interferencias; apertura 0–180° y cierres 0–80° sin choques.
3. Inclinada: mecánica intacta y sin voladizos > 50° sin soporte.
4. Apilable: asienta sin interferencia y bloquea ±0.6 mm en X e Y, también
   con bases poco profundas.
5. Insertos: sin interferencia con la caja ni con el contenido.
6. Pasadores y tapones: no se solapan con la caja, la tapa abre sin tocarlos,
   tienen camino de montaje libre y el filamento entra recto.
7. Piezas planas: ningún puente/voladizo más ancho que `maxBridge`.
8. Mecánica completa en base y tapa (`mechChecks`).
9. Espesor mínimo de 2 líneas (0.9 mm) en base y tapa, lengüetas incluidas
   (`thicknessChecks`: cortes XY, YZ por la mecánica y XZ por la banda).

## Flujo con el PC del usuario

El repo vive en `la carpeta del repositorio` (git local, rama
`main`). Se desarrolla en la nube y se sincroniza con un tar; en el PC se
compila y prueba con `./node_modules/.bin/vite build` y `node tests/...`
(la VM del PC no tiene acceso a npm). Commits con autor Parra0713.
