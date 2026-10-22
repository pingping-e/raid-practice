import * as THREE from "three";
import { Simulation, ARENA, markers, point } from "./engine";
import { Input } from "./input";
const roleColors = { tank: 0x66b6ff, healer: 0x65e6ac, damage: 0xb4a1ef };
export class View {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 250);
  renderer: THREE.WebGLRenderer;
  actors = new Map<number, THREE.Group>();
  hazards = new Map<number, THREE.Object3D>();
  casts = new Map<string, THREE.Mesh>();
  boss = new THREE.Group();
  goal: THREE.Mesh;
  fury: THREE.Mesh;
  targetLine: THREE.Line;
  last = 0;
  constructor(public host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b1419);
    host.appendChild(this.renderer.domElement);
    this.scene.fog = new THREE.FogExp2(0x0b1419, 0.009);
    this.scene.add(new THREE.HemisphereLight(0xb9ecd5, 0x17242a, 2.5));
    const sun = new THREE.DirectionalLight(0xc7fbdc, 3);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA, ARENA + 2, 1, 96),
      new THREE.MeshStandardMaterial({ color: 0x243c39, roughness: 0.9 }),
    );
    floor.position.y = -0.6;
    this.scene.add(floor);
    for (const r of [8, 16, 24, 32, 42]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.06, r + 0.06, 96),
        new THREE.MeshBasicMaterial({
          color: r === 42 ? 0x7dbea2 : 0x45635a,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      this.scene.add(ring);
    }
    for (let i = 0; i < 16; i++) {
      const p = point((i * Math.PI) / 8, 40);
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.3 + (i % 3) * 0.5),
        new THREE.MeshStandardMaterial({ color: 0x344b46 }),
      );
      rock.position.set(p.x, 0.7, p.z);
      rock.scale.y = 2;
      this.scene.add(rock);
    }
    markers.forEach((p, i) => {
      const material = new THREE.MeshStandardMaterial({
        color: [0xffd76b, 0x8bd7ff, 0xf39af4, 0x7cedbb][i],
        emissive: [0x886010, 0x184c77, 0x63176c, 0x18593f][i],
      });
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), material);
      mesh.position.set(p.x, 4, p.z);
      this.scene.add(mesh);
      const text = this.label(
        ["A · 북", "B · 동", "C · 남", "D · 서"][i],
        "#e8f4ef",
      );
      text.position.set(p.x, 6, p.z);
      this.scene.add(text);
    });
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(3.8, 9, 6),
      new THREE.MeshStandardMaterial({ color: 0x9fb785, roughness: 0.6 }),
    );
    body.position.y = 4.5;
    this.boss.add(body);
    const head = new THREE.Mesh(
      new THREE.DodecahedronGeometry(2),
      new THREE.MeshStandardMaterial({ color: 0xb2d098 }),
    );
    head.position.set(0, 7, 2.6);
    this.boss.add(head);
    for (const x of [-2.6, 2.6]) {
      const horn = new THREE.Mesh(
        new THREE.ConeGeometry(0.65, 4, 6),
        new THREE.MeshStandardMaterial({ color: 0x657958 }),
      );
      horn.position.set(x, 8.5, 0);
      horn.rotation.z = x > 0 ? -0.5 : 0.5;
      this.boss.add(horn);
    }
    const bossLabel = this.label("스조라크", "#e3ecd7");
    bossLabel.position.y = 12;
    this.boss.add(bossLabel);
    this.scene.add(this.boss);
    this.goal = this.disc(1, 0x91ffc6, 0.65);
    this.goal.position.y = 0.09;
    this.scene.add(this.goal);
    this.fury = this.disc(8, 0x8b73ff, 0.17);
    this.fury.position.y = 0.07;
    this.scene.add(this.fury);
    this.targetLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x8cddaa,
        transparent: true,
        opacity: 0.55,
      }),
    );
    this.scene.add(this.targetLine);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }
  label(text: string, color: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 62);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        depthTest: false,
      }),
    );
    sprite.scale.set(9, 1.7, 1);
    return sprite;
  }
  disc(r: number, color: number, opacity: number) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(r, 64),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  remove(object: THREE.Object3D) {
    this.scene.remove(object);
    object.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
  render(sim: Simulation, input: Input, showGoal: boolean) {
    const liveIds = new Set(sim.actors.map((a) => a.id));
    for (const [id, obj] of this.actors)
      if (!liveIds.has(id)) {
        this.remove(obj);
        this.actors.delete(id);
      }
    for (const a of sim.actors) {
      let g = this.actors.get(a.id);
      if (!g) {
        g = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.55, 1, 4, 8),
          new THREE.MeshStandardMaterial({
            color: a.id === 0 ? 0xffdf87 : roleColors[a.role],
          }),
        );
        body.position.y = 1.1;
        g.add(body);
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.28, 0.8, 3),
          new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
        arrow.rotation.x = Math.PI / 2;
        arrow.position.set(0, 1.1, 0.9);
        g.add(arrow);
        const label = this.label(a.id === 0 ? "나" : String(a.id), "#d2e1d9");
        label.position.y = 3;
        label.scale.set(3, 0.7, 1);
        g.add(label);
        this.scene.add(g);
        this.actors.set(a.id, g);
      }
      g.position.set(a.x, a.y, a.z);
      g.rotation.y = a.facing;
      const body = g.children[0] as THREE.Mesh;
      const material = body.material as THREE.MeshStandardMaterial;
      material.color.setHex(
        a.virulent > sim.time
          ? 0xa7ed51
          : a.id === 0
            ? 0xffdf87
            : roleColors[a.role],
      );
      material.emissive.setHex(a.vulnerable > sim.time ? 0x882a21 : 0);
    }
    this.boss.rotation.y = sim.bossFacing;
    const ids = new Set(sim.hazards.map((h) => h.id));
    for (const [id, m] of this.hazards)
      if (!ids.has(id)) {
        this.remove(m);
        this.hazards.delete(id);
      }
    for (const h of sim.hazards) {
      let m = this.hazards.get(h.id);
      if (!m) {
        if (h.kind === "tornado") {
          m = new THREE.Mesh(
            new THREE.ConeGeometry(h.radius, 5, 12, 1, true),
            new THREE.MeshStandardMaterial({
              color: 0xb4dfff,
              transparent: true,
              opacity: 0.6,
              side: THREE.DoubleSide,
            }),
          );
        } else if (h.kind === "cyst")
          m = new THREE.Mesh(
            new THREE.SphereGeometry(h.radius, 16, 12),
            new THREE.MeshStandardMaterial({
              color: 0xe3c463,
              emissive: 0x5a4717,
              transparent: true,
              opacity: 0.8,
            }),
          );
        else if (h.kind === "cross") {
          m = new THREE.Group();
          for (const rot of [0, Math.PI / 2]) {
            const bar = new THREE.Mesh(
              new THREE.PlaneGeometry(2, h.radius * 2),
              new THREE.MeshBasicMaterial({
                color: 0xc1fa51,
                transparent: true,
                opacity: 0.7,
                side: THREE.DoubleSide,
              }),
            );
            bar.rotation.set(-Math.PI / 2, 0, rot);
            m.add(bar);
          }
        } else m = this.disc(h.radius, 0x97bc31, 0.5);
        this.scene.add(m);
        this.hazards.set(h.id, m);
      }
      m.position.set(
        h.x,
        h.kind === "tornado" ? 2.5 : h.kind === "cyst" ? 1.4 : 0.13,
        h.z,
      );
      if (h.kind === "tornado") m.rotation.y = sim.time * 4;
      else if (h.kind === "cross") m.rotation.y = h.rotation;
    }
    const casts = sim.casts.filter(
      (c) => !c.resolved && ["Mutilate", "Ravage"].includes(c.event.kind),
    );
    const cids = new Set(casts.map((c) => c.event.id));
    for (const [id, m] of this.casts)
      if (!cids.has(id)) {
        this.remove(m);
        this.casts.delete(id);
      }
    for (const c of casts) {
      let m = this.casts.get(c.event.id);
      if (!m) {
        const half = c.event.kind === "Mutilate" ? 0.62 : 0.48,
          radius = c.event.kind === "Mutilate" ? 19 : 34;
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        for (let i = 0; i <= 32; i++) {
          const a = -half + (i / 32) * half * 2;
          shape.lineTo(Math.sin(a) * radius, Math.cos(a) * radius);
        }
        shape.lineTo(0, 0);
        m = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshBasicMaterial({
            color: c.event.kind === "Mutilate" ? 0xf5b25d : 0xff5d68,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        m.rotation.x = Math.PI / 2;
        m.position.y = 0.12;
        this.scene.add(m);
        this.casts.set(c.event.id, m);
      }
      m.rotation.z = -c.facing;
    }
    const p = sim.player;
    this.goal.visible = showGoal;
    this.goal.position.x = p.goal.x;
    this.goal.position.z = p.goal.z;
    this.targetLine.visible = showGoal;
    this.targetLine.geometry.dispose();
    this.targetLine.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p.x, 0.2, p.z),
      new THREE.Vector3(p.goal.x, 0.2, p.goal.z),
    ]);
    this.fury.visible = sim.fury !== null;
    if (sim.fury) {
      const t = sim.actors[sim.fury.target];
      this.fury.position.x = t.x;
      this.fury.position.z = t.z;
    }
    const horizontal = Math.cos(input.pitch) * input.zoom;
    this.camera.position.set(
      p.x - Math.sin(input.yaw) * horizontal,
      p.y + 3 + Math.sin(input.pitch) * input.zoom,
      p.z - Math.cos(input.yaw) * horizontal,
    );
    this.camera.lookAt(p.x, p.y + 2, p.z);
    this.renderer.render(this.scene, this.camera);
  }
}
