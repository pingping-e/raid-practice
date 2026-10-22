import type { Vec } from "./engine";
export type Bindings = {
  forward: string;
  back: string;
  left: string;
  right: string;
  strafeLeft: string;
  strafeRight: string;
  jump: string;
};
export const defaultBindings: Bindings = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  strafeLeft: "KeyQ",
  strafeRight: "KeyE",
  jump: "Space",
};
export class Input {
  keys = new Set<string>();
  buttons = new Set<number>();
  yaw = Math.PI;
  pitch = 0.5;
  zoom = 24;
  facing = Math.PI;
  jump = false;
  sensitivity = 1;
  bindings: Bindings = { ...defaultBindings };
  constructor(
    public element: HTMLElement,
    public onBlur: () => void,
  ) {
    window.addEventListener("keydown", (e) => {
      if (this.editing() || !Object.values(this.bindings).includes(e.code))
        return;
      e.preventDefault();
      this.keys.add(e.code);
      if (e.code === this.bindings.jump) this.jump = true;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    element.addEventListener("contextmenu", (e) => e.preventDefault());
    element.addEventListener("pointerdown", (e) => {
      if (e.button > 2) return;
      this.buttons.add(e.button);
      element.setPointerCapture(e.pointerId);
    });
    element.addEventListener("pointermove", (e) => {
      if (!this.buttons.has(0) && !this.buttons.has(2)) return;
      this.yaw -= e.movementX * 0.004 * this.sensitivity;
      this.pitch = Math.max(
        0.12,
        Math.min(1.28, this.pitch + e.movementY * 0.003 * this.sensitivity),
      );
      if (this.buttons.has(2)) this.facing = this.yaw;
    });
    window.addEventListener("pointerup", (e) => {
      this.buttons.delete(e.button);
      if (element.hasPointerCapture(e.pointerId))
        element.releasePointerCapture(e.pointerId);
    });
    element.addEventListener("lostpointercapture", () => this.buttons.clear());
    element.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(8, Math.min(56, this.zoom + e.deltaY * 0.025));
      },
      { passive: false },
    );
    window.addEventListener("blur", () => {
      this.clear();
      this.onBlur();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.clear();
        this.onBlur();
      }
    });
    document.addEventListener("focusin", () => {
      if (this.editing()) this.clear();
    });
  }
  editing() {
    return (
      document.activeElement instanceof HTMLElement &&
      !!document.activeElement.closest(
        'input,select,textarea,[contenteditable="true"]',
      )
    );
  }
  clear() {
    this.keys.clear();
    this.buttons.clear();
    this.jump = false;
  }
  movement(dt: number): Vec {
    if (this.editing()) return { x: 0, z: 0 };
    const k = this.keys,
      b = this.bindings;
    let x = 0,
      z = 0;
    if (k.has(b.forward) || (this.buttons.has(0) && this.buttons.has(2))) z++;
    if (k.has(b.back)) z--;
    if (k.has(b.strafeLeft)) x++;
    if (k.has(b.strafeRight)) x--;
    if (this.buttons.has(2)) {
      if (k.has(b.left)) x++;
      if (k.has(b.right)) x--;
      this.facing = this.yaw;
    } else {
      if (k.has(b.left)) {
        this.facing += dt * 2.1;
        this.yaw += dt * 2.1;
      }
      if (k.has(b.right)) {
        this.facing -= dt * 2.1;
        this.yaw -= dt * 2.1;
      }
    }
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    return {
      x: Math.sin(this.facing) * z + Math.cos(this.facing) * x,
      z: Math.cos(this.facing) * z - Math.sin(this.facing) * x,
    };
  }
  consumeJump() {
    const value = this.jump;
    this.jump = false;
    return value;
  }
}
