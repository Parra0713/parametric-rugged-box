# Guía de diseño de la interfaz — los diez mandamientos

La interfaz de Rugged Box sigue la filosofía de las *Human Interface
Guidelines* de Apple: la herramienta desaparece y queda el trabajo. Esta guía
es **obligatoria** para cualquier cambio en `index.html`, `src/style.css`,
`src/main.js`, `src/viewer.js` y en los textos del esquema
(`SCHEMA` en `src/engine/params.js`).

Los principios de Apple de los que sale cada mandamiento van entre paréntesis:
propósito, agencia, responsabilidad, familiaridad, flexibilidad, sencillez,
artesanía y deleite (y los tres clásicos: claridad, deferencia y profundidad).

`node tests/ui-guide.test.mjs` comprueba solo lo que se puede medir (está en
`npm test`); `npm run test:ui` lo comprueba en un navegador real.

---

## 1. La caja es la protagonista *(deferencia, propósito)*

El visor 3D ocupa el centro y todo lo demás se aparta: paneles neutros, sin
color decorativo, sin sombras ni bordes que no separen nada. Lo que flota
sobre el visor (barra de vistas, avisos de cálculo, notificaciones) es
translúcido para que la caja se siga viendo detrás.

- Un panel nuevo solo se justifica si ayuda a decidir algo sobre la caja.
- Nada de logotipos grandes, lemas, banners ni "novedades".

## 2. Claro antes que denso *(claridad, sencillez)*

- Tipografía del sistema (`--font`: San Francisco en Apple, Segoe UI
  Variable en Windows). 13 px de base, 12 px para lo secundario, nunca menos.
- La jerarquía se hace con **tamaño y peso**, no con MAYÚSCULAS, ni con
  cajas dentro de cajas, ni con tipografía monoespaciada (solo el registro).
  Cifras tabulares (`font-variant-numeric: tabular-nums`) para que las cotas
  no bailen.
- Frase normal en todo: «Tapa interior», no «TAPA INTERIOR» ni «Tapa
  Interior». Las etiquetas no acaban en punto.
- Se habla como el usuario, no como el motor: «compartimentos», «tapa
  interior», «espacio útil»; nunca `orgB`, `lidMode` ni «grupo A».
- Los números llevan su unidad pegada al valor y coma decimal en los textos.

## 3. Un solo acento, y el color nunca va solo *(claridad, responsabilidad)*

- El naranja de la tapa (`--accent`, `--accent-fill`) marca **solo** lo
  interactivo seleccionado y la acción principal de cada sitio (una por
  vista: «Exportar todo»).
- Verde, ámbar y rojo (`--ok`, `--warn`, `--err`) son estado, nunca
  decoración, y siempre van con texto («Cabe plana», «2 avisos»): nadie
  depende de distinguir un color.
- Contraste AA: texto ≥ 4,5:1 sobre su fondo, en claro y en oscuro. Los
  valores están en `:root`; no se escriben colores sueltos en los
  componentes.

## 4. Se enseña solo lo que aplica *(sencillez, flexibilidad)*

Revelación progresiva en tres niveles:

1. **Por defecto**, lo que casi todo el mundo toca. Todo ajuste tiene un
   valor inicial bueno: la caja por defecto es imprimible sin tocar nada.
2. **Según lo elegido**: un ajuste aparece cuando su opción está activa
   (`when: (P) => …` en el esquema). Sin imanes no se ve «Diámetro del
   imán»; sin compartimentos no se ven columnas ni filas.
3. **Ajustes avanzados**: detrás de su interruptor (`adv: true`), y el grupo
   dice cuántos hay ocultos.

Lo que no aplica **se oculta**, no se desactiva en gris (un control gris
obliga a adivinar por qué).

## 5. Se toca y se ve *(manipulación directa, respuesta inmediata)*

- Cada cambio se ve en el visor en el siguiente fotograma (vista rápida) y
  se afina solo. **No existe el botón «Aplicar»** para un parámetro.
- El deslizador y su campo numérico son el mismo valor: mover uno mueve el
  otro, y se puede escribir una cifra exacta.
- Mientras se calcula, la interfaz sigue respondiendo (la geometría va en
  hilos aparte) y un indicador discreto dice qué pasa («Calculando…»,
  «Afinando el modelo…»). Nunca una pantalla bloqueada ni un cursor de espera.

## 6. El usuario manda, y puede equivocarse *(agencia, perdón)*

- **Deshacer y rehacer siempre**: Ctrl/⌘+Z y Ctrl/⌘+Mayús+Z, y sus botones.
  Arrastrar un deslizador cuenta como un solo paso.
- Lo que se puede deshacer **no pregunta**: se hace y se ofrece «Deshacer»
  en la notificación (restablecer la caja, quitar un objeto o el logo).
- Lo irreversible (borrar un perfil, descartar un test) se confirma en una
  hoja propia, con el verbo de la acción en el botón («Borrar», no
  «Aceptar»), el foco en «Cancelar» y Esc para salir.
- **Prohibido** `alert()`, `confirm()` y `prompt()` del navegador: bloquean
  la página, no se pueden estilar ni traducir y rompen el foco.
- Nada se guarda ni se descarga sin que el usuario lo pida.

## 7. Lo de siempre, donde siempre *(familiaridad, consistencia)*

Cada tipo de dato tiene un único control, y se comporta como en el sistema:

| Dato | Control |
| --- | --- |
| Sí / no | Interruptor |
| Una opción entre varias | Menú desplegable (o segmentos si son 2–4 vistas) |
| Número | Deslizador + campo con unidad |
| Acción | Botón con verbo («Exportar todo», «Añadir objetos…») |
| Secciones del trabajo | Control segmentado (pestañas) |

- Los puntos suspensivos en un botón avisan de que pide algo más antes de
  actuar («Renombrar…», «Borrar…»).
- Una cosa se llama igual en el panel, en los avisos, en el LEEME y en los
  nombres de archivo.
- El orden de las pestañas es el del trabajo: caja → contenido → tapa →
  mecánica → impresión.

## 8. Se informa sin interrumpir *(responsabilidad)*

- El estado va en su sitio: insignias en el resumen, avisos junto al
  resultado, y notificaciones breves que se van solas para lo puntual
  («Medidas copiadas», «Exportado: …»).
- Un aviso dice **qué pasa y qué hacer**: «No caben con estas medidas.
  Agranda la caja o elige "Ajustarlo al contenido"», no «Error de acomodo».
- Los errores no piden perdón ni culpan; nunca se enseña una traza al
  usuario (va a la consola y al registro descargable).
- Un sitio vacío invita a actuar: «Todavía no hay objetos. Añade el calco…».
- Lo que hay que comprar o cortar además de imprimir (imanes, cordón,
  filamento) se dice en el resumen y en el LEEME, con cantidades.

## 9. Para todo el mundo *(accesibilidad)*

- Todo se maneja con teclado; el foco es visible (`:focus-visible`, anillo
  del acento) y sigue el orden de lectura. Al repintar un panel, el foco
  vuelve al control que se estaba usando.
- Cada control tiene nombre accesible (`<label>`, `aria-label`); los
  botones de icono, también. Los interruptores llevan `role="switch"`; el
  estado en vivo, `role="status"` / `aria-live`.
- Objetivos de 28 px con ratón y **44 px con el dedo**
  (`@media (pointer: coarse)`).
- Se respetan los ajustes del sistema: claro/oscuro, «reducir movimiento»
  (sin animaciones) y «más contraste».
- La página funciona de 360 px a pantalla completa: en estrecho, el visor
  arriba y los paneles debajo, sin desplazamiento horizontal.

## 10. Hecha con oficio, y rápida *(artesanía, deleite)*

- Rejilla de 4 px; radios 6 (controles), 10 (grupos) y 14 (hojas y
  materiales flotantes). Alineaciones exactas: una etiqueta torcida es un
  fallo, no un detalle.
- El movimiento explica un cambio (un interruptor que se desliza, una hoja
  que aparece) y dura 150–250 ms. Nada se mueve porque sí.
- El rendimiento es parte del diseño: el visor solo dibuja cuando algo
  cambia; al escribir en un campo no se repinta el panel; nada de trabajo
  pesado en el hilo de la interfaz.
- **No se deja basura**: cada geometría, material, temporizador, URL de
  descarga, diálogo y escucha que se crea se libera al dejar de usarse (los
  diálogos se eliminan al cerrarse, las notificaciones limpian su
  temporizador, el visor hace `dispose()` de lo que quita, el historial
  tiene tope).
- El deleite es que todo encaje a la primera: valores por defecto que
  funcionan, textos que se entienden y una caja que sale bien impresa.

---

## Lista de comprobación antes de dar por bueno un cambio de interfaz

1. ¿Se entiende sin leer documentación? ¿El texto es de usuario, en frase
   normal, sin mayúsculas ni jerga?
2. ¿El ajuste nuevo tiene valor por defecto bueno y `when` si depende de
   otra opción? ¿`adv` si casi nadie lo toca?
3. ¿Se ve el efecto al instante en el visor? ¿Se puede deshacer?
4. ¿Funciona solo con teclado, con foco visible? ¿Tiene nombre accesible?
5. ¿Se lee bien en claro y en oscuro (contraste AA)? ¿Usa las variables de
   `:root` y no colores sueltos?
6. ¿Avisa sin bloquear? ¿Nada de `alert`/`confirm`/`prompt`?
7. ¿Libera lo que crea? (Abrir y cerrar 20 veces no debe dejar nodos,
   temporizadores ni memoria.)
8. ¿El texto nuevo está en `es.js` y `en.js` (o en SCHEMA + `en.js`)?
   `npm run i18n` en verde.
9. `node tests/ui-guide.test.mjs` en verde y, tras `npm run build`,
   `npm run test:ui`.

## Idiomas: hablar como se habla en el hobby

La interfaz usa las palabras de los slicers (PrusaSlicer, Orca, Bambu
Studio, Cura) y de los foros de impresión 3D, no traducciones de
diccionario. Mismo nombre para lo mismo en panel, avisos, README y archivos.

| Español | English | Evitar |
|---|---|---|
| slicer | slicer | laminador |
| tolerancia | clearance / tolerance | holgura |
| pieza de prueba, test de tolerancias | test piece, tolerance test | probeta |
| paredes, capas superiores/inferiores | walls, top/bottom layers | perímetros (en textos al usuario) |
| relleno (gyroid) | infill (gyroid) | |
| brim, raft, mouse ears | brim, raft, mouse ears | balsa, borde |
| voladizo, puente | overhang, bridge | |
| tapa, base, cierre, bisagra, nudillos, pasador | lid, base, latch, hinge, knuckles, pin | |
| junta, lengüeta, ranura | gasket, tongue, groove | |
| tapa interior, compartimentos | compartment lid, compartments | |
| inserto, huecos, hueco para el dedo | insert, cutouts, finger cutout | |
| ajuste a presión | press-fit | |
| línea de contracción | shrink line | |

Reglas de forma: frase normal (sentence case) en ambos idiomas; en inglés,
ortografía de EE. UU. y «25%» sin espacio; en español, coma decimal y
«25 %». Las cifras pasan por `fmtN`/`mm`/`dims`, que ya aplican el formato
del idioma.

## Variables de diseño (`src/style.css`)

| Variable | Uso |
| --- | --- |
| `--bg`, `--surface`, `--stage` | Ventana y paneles · campos y hojas · fondo del visor |
| `--fill`, `--fill-2` | Relleno de controles · pulsado y pista del deslizador |
| `--line` | Separadores de 1 px |
| `--text`, `--text-2` | Texto principal y secundario |
| `--accent`, `--accent-fill`, `--on-accent` | Acento en texto · en rellenos · texto sobre el relleno |
| `--ok`, `--warn`, `--err` (+ `-bg`) | Estado, siempre con texto |
| `--material`, `--shadow` | Capas translúcidas sobre el visor |
| `--r-s`, `--r-m`, `--r-l` | Radios 6 / 10 / 14 |

Fuente: Apple, *Human Interface Guidelines* (principios de diseño,
accesibilidad, color, tipografía, movimiento, alertas y deshacer).
