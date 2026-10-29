/**
 * viewer.js — Vista 3D (three.js) con render bajo demanda.
 *
 * Solo se dibuja un fotograma cuando algo cambia (cámara, geometría,
 * animación). Con la vista quieta el consumo de GPU/CPU es prácticamente 0.
 *
 * Modos:
 *   assembled → caja montada; el deslizador "apertura" abre primero los
 *               cierres y luego la tapa alrededor del eje real de la bisagra.
 *   exploded  → piezas separadas para ver cómo se montan.
 *   print     → placas de impresión con cada pieza orientada y girada según
 *               el optimizador de cama.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const COLORS = {
  insert: 0x7fb3d5, insertLid: 0xa9cce3, orgPanel: 0x9fd3c7,
  base: 0x343a3f, lid: 0xd9601a, latch: 0xe8b10c, gasket: 0x1fa596,
  hingePin: 0xc8cbce, latchPin: 0xc8cbce, cap: 0xc8cbce,
};

const fromCols = (a) => new THREE.Matrix4().fromArray(a);

export class Viewer {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    el.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 10000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-260, -320, 220);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-1, -1.4, 2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(1.5, 1, 0.5);
    this.scene.add(rim);

    this.grid = new THREE.GridHelper(600, 60, 0x555a60, 0x2c3034);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.clipOn = false;
    this.materials = {};
    this.mode = 'assembled';
    this.open = 0;
    this.showInner = false;
    this.data = null;
    this.layout = null;
    this.geoms = {};

    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
  }

  setTheme(dark) {
    this.scene.background = new THREE.Color(dark ? 0x17191b : 0xe9ebed);
    this.grid.material.color = new THREE.Color(dark ? 0x2c3034 : 0xc9cdd1);
    this.requestRender();
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  material(id) {
    if (!this.materials[id]) {
      this.materials[id] = new THREE.MeshStandardMaterial({
        color: COLORS[id] ?? (id.startsWith('cal') ? 0xd9601a : 0x999999),
        roughness: id === 'gasket' ? 0.85 : 0.55,
        metalness: id.includes('Pin') || id === 'cap' ? 0.25 : 0.05,
        side: THREE.DoubleSide,
        clippingPlanes: [],
      });
    }
    return this.materials[id];
  }

  aidMaterial() {
    if (!this._aid) this._aid = new THREE.MeshStandardMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.55, roughness: 0.8, side: THREE.DoubleSide });
    return this._aid;
  }

  /** Convierte la malla del motor (posición + normal intercaladas) en geometría. */
  geometry(mesh) {
    const g = new THREE.BufferGeometry();
    const ib = new THREE.InterleavedBuffer(mesh.vert, mesh.numProp);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    if (mesh.numProp >= 6) g.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    else g.computeVertexNormals();
    g.setIndex(new THREE.BufferAttribute(mesh.tri, 1));
    g.computeBoundingSphere();
    return g;
  }

  /** Recibe un resultado del motor y la disposición de impresión. */
  setData(res, layout, bed, content) {
    for (const g of Object.values(this.geoms)) g.dispose();
    this.geoms = {};
    for (const p of res.parts) this.geoms[p.key] = this.geometry(p.mesh);
    const first = !this.data;
    this.data = res;
    this.layout = layout;
    this.bed = bed;
    if (content !== undefined) this.content = content;
    this.rebuild();
    if (first) this.fit();
  }

  setMode(m) { this.mode = m; this.rebuild(); this.fit(); }
  setOpen(t) { this.open = t; this.rebuild(); }
  setInterior(on) { this.showInner = on; this.rebuild(); }

  setSection(on, pos) {
    this.clipOn = on;
    this.clip.constant = pos;
    for (const m of Object.values(this.materials)) m.clippingPlanes = on ? [this.clip] : [];
    this.requestRender();
  }

  clearRoot() {
    while (this.root.children.length) {
      const c = this.root.children.pop();
      if (c.userData.own) { c.geometry?.dispose(); if (c.material !== this._aid) c.material?.dispose?.(); }
    }
  }

  addMesh(p, m4) {
    const mesh = new THREE.Mesh(this.geoms[p.key], this.material(p.id));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m4);
    this.root.add(mesh);
    return mesh;
  }

  rebuild() {
    if (!this.data) return;
    this.clearRoot();
    const { parts, assembly, D } = this.data;
    const byId = Object.fromEntries(parts.map((p) => [p.key, p]));

    // El motor modela con el lado largo en X; si el usuario lo pidió al revés
    // se gira el conjunto 90° solo para mostrarlo (la impresión no cambia).
    this.root.rotation.z = this.mode !== 'print' && assembly.rot90 ? Math.PI / 2 : 0;
    this.root.updateMatrixWorld(true);
    if (this.mode === 'print') { this.buildPrint(byId); this.requestRender(); return; }

    const ex = this.mode === 'exploded';
    // Secuencia de apertura: 0–0.3 cierres (0→80°), 0.3–1 tapa (0→110°).
    // Con organizador: la tapa hasta 0.75 y de 0.75 a 1 las tapas interiores.
    const hasOrg = parts.some((p) => p.id === 'orgPanel');
    const tLatch = Math.min(1, this.open / 0.3);
    const tLid = Math.min(1, Math.max(0, (this.open - 0.3) / (hasOrg ? 0.45 : 0.7)));
    const orgAng = (ex ? 0 : Math.max(0, (this.open - 0.75) / 0.25) * 95) * Math.PI / 180;
    const latchAng = (ex ? 0 : tLatch * 80) * Math.PI / 180;
    const lidAng = (ex ? 0 : tLid * 110) * Math.PI / 180;
    const about = (y, z, ang) => new THREE.Matrix4().makeTranslation(0, y, z)
      .multiply(new THREE.Matrix4().makeRotationX(ang))
      .multiply(new THREE.Matrix4().makeTranslation(0, -y, -z));
    const exOff = (dx, dy, dz) => new THREE.Matrix4().makeTranslation(ex ? dx : 0, ex ? dy : 0, ex ? dz : 0);

    for (const p of parts) {
      for (const inst of p.instances) {
        let m = fromCols(inst);
        if (p.id === 'lid') {
          m = about(assembly.hinge.y, assembly.hinge.z, -lidAng).multiply(m);
          m = exOff(0, 0, D.Hl + 35).multiply(m);
        } else if (p.id === 'latch') {
          m = about(assembly.latch.y, assembly.latch.z, latchAng).multiply(m);
          m = exOff(0, -30, 0).multiply(m);
        } else if (p.id === 'insert') {
          m = exOff(0, 0, D.Hl + D.Db + 70).multiply(m);
        } else if (p.id === 'orgPanel') {
          // Tapas interiores: giran sobre su eje (al final de la apertura) y
          // van con la tapa.
          if (p.axis && orgAng > 0) m = about(p.axis.y + inst[13], p.axis.z, -orgAng).multiply(m);
          m = about(assembly.hinge.y, assembly.hinge.z, -lidAng).multiply(m);
          m = exOff(0, 0, D.Hl + 35 - 18).multiply(m);
        } else if (p.id === 'insertLid') {
          m = about(assembly.hinge.y, assembly.hinge.z, -lidAng).multiply(m);
          m = exOff(0, 0, D.Hl + 35 + 25).multiply(m);
        } else if (p.id === 'gasket') {
          m = exOff(0, 0, D.Hl * 0.5 + 15).multiply(m);
        } else if (p.id === 'hingePin' || (p.id === 'cap' && m.elements[13] > 0)) {
          m = exOff(-D.Lband * 0.5 - 30, 25, 0).multiply(m);
        } else if (p.id === 'latchPin' || p.id === 'cap') {
          m = exOff(-D.Lband * 0.5 - 30, -40, 0).multiply(m);
        }
        this.addMesh(p, m);
      }
    }

    if (this.showInner) {
      // Volumen útil interior (para diseñar insertos): verde translúcido.
      const I = D.inner;
      const r = I.inner_corner_radius;
      const s = new THREE.Shape();
      const L = D.Li / 2, W = D.Wi / 2;
      s.moveTo(-L + r, -W); s.lineTo(L - r, -W); s.absarc(L - r, -W + r, r, -Math.PI / 2, 0);
      s.lineTo(L, W - r); s.absarc(L - r, W - r, r, 0, Math.PI / 2);
      s.lineTo(-L + r, W); s.absarc(-L + r, W - r, r, Math.PI / 2, Math.PI);
      s.lineTo(-L, -W + r); s.absarc(-L + r, -W + r, r, Math.PI, 1.5 * Math.PI);
      if (D.cham > 0) {            // octógono alargado
        s.curves = []; s.currentPoint.set(0, 0);
        D.innerOutline.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
        s.closePath();
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: I.closedHeight, bevelEnabled: false, curveSegments: 8 });
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0x3ddc84, transparent: true, opacity: 0.22, depthWrite: false,
      }));
      mesh.position.z = assembly.z0 + D.floorTop;
      mesh.userData.own = true;
      this.root.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30),
        new THREE.LineBasicMaterial({ color: 0x3ddc84 }));
      edges.position.copy(mesh.position);
      edges.userData.own = true;
      this.root.add(edges);
    }
    if (this.content && this.content.length) {
      // Contorno del contenido (SVG calcado), extruido a la profundidad de la base.
      const mat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
      for (const poly of this.content) {
        const sh = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
        const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(1, D.Db), bevelEnabled: false });
        const m = new THREE.Mesh(g, mat);
        m.position.z = assembly.z0 + D.floorTop + 0.05;
        m.userData.own = true;
        this.root.add(m);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 40), new THREE.LineBasicMaterial({ color: 0xffb347 }));
        e.position.copy(m.position); e.userData.own = true;
        this.root.add(e);
      }
    }
    this.grid.visible = true;
    this.requestRender();
  }

  /** Contorno del contenido en el marco interno (lista de polígonos). */
  setContent(polys) { this.content = polys; this.rebuild(); }

  /** Placas de impresión, una junto a otra en +X. */
  buildPrint(byId) {
    if (!this.layout) return;
    const { x: bx, y: by } = this.bed;
    this.layout.plates.forEach((plate, k) => {
      const ox = k * (bx + 40);
      // Contorno de la cama.
      const bedG = new THREE.PlaneGeometry(bx, by);
      const bedM = new THREE.Mesh(bedG, new THREE.MeshStandardMaterial({ color: 0x24292d, roughness: 0.9 }));
      bedM.position.set(ox + bx / 2, by / 2, -0.05);
      bedM.userData.own = true;
      this.root.add(bedM);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(bedG), new THREE.LineBasicMaterial({ color: 0xd9601a }));
      edge.position.copy(bedM.position);
      edge.userData.own = true;
      this.root.add(edge);
      for (const it of plate.items) {
        const p = byId[it.partId];
        if (!p) continue;
        const place = new THREE.Matrix4().makeTranslation(ox + it.tx, it.ty, 0)
          .multiply(new THREE.Matrix4().makeRotationZ(it.angle * Math.PI / 180));
        this.addMesh(p, place.clone().multiply(fromCols(p.print)));
        // Ayudas de impresión (ya en coordenadas de impresión de la pieza).
        for (const ad of p.aids || []) {
          const g = this.geometry(ad.mesh);
          const am = new THREE.Mesh(g, this.aidMaterial());
          am.matrixAutoUpdate = false;
          am.matrix.copy(place);
          am.userData.own = true;
          this.root.add(am);
        }
      }
    });
    this.grid.visible = false;
  }

  fit() {
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    const d = r / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;
    const dir = this.mode === 'print' ? new THREE.Vector3(0, -0.9, 1.3) : new THREE.Vector3(-0.75, -1, 0.75);
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(dir.normalize().multiplyScalar(d));
    this.camera.near = d / 100; this.camera.far = d * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }
}
