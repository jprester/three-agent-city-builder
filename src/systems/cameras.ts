import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FlythroughPath } from './flythrough';

export type CameraMode = 'orbit' | 'fly' | 'flythrough';
export const CAMERA_MODES: CameraMode[] = ['orbit', 'fly', 'flythrough'];

export function isCameraMode(v: string): v is CameraMode {
  return (CAMERA_MODES as string[]).includes(v);
}

/** Free-fly tuning: meters per second, boost multiplier, mouse radians per pixel. */
const FLY = { speed: 14, minSpeed: 2, maxSpeed: 200, boost: 5, look: 0.0022, response: 10, floor: 0.6 };
/** Orbit target distance in front of the camera when switching into orbit mode. */
const ORBIT_TARGET = 60;
/** Free-fly keeps this far (m) from walls and roofs. */
const CLEARANCE = 0.8;

/** A building's footprint box for free-fly collision: center, unit x axis, half extents, roof. */
export interface Obstacle { x: number; z: number; ux: number; uz: number; hx: number; hz: number; h: number }

/** Obstacles from layout instances: footprint half extents `fp`, `rotationY`, height `h`. */
export function obstaclesFrom(instances: { position: number[]; rotationY: number; fp?: number[]; h?: number }[]): Obstacle[] {
  return instances.filter((i) => i.fp && i.h).map((i) => ({
    // Same frame as the layout's instance boxes: local x = (cos t, -sin t) on the ground.
    x: i.position[0], z: i.position[2], ux: Math.cos(i.rotationY), uz: -Math.sin(i.rotationY),
    hx: i.fp![0], hz: i.fp![1], h: i.h!,
  }));
}

/**
 * Move `p` out of any building it is inside (grown by CLEARANCE), along the shallowest way
 * out: through the nearest wall, or up onto the roof. Returns true when it landed on a roof.
 */
export function pushOut(p: THREE.Vector3, obstacles: Obstacle[]): boolean {
  let roof = false;
  for (const o of obstacles) {
    const dx = p.x - o.x, dz = p.z - o.z;
    if (Math.abs(dx) + Math.abs(dz) > o.hx + o.hz + 2 * CLEARANCE) continue;
    // Local axes: x = (ux, uz), z = (-uz, ux).
    const lx = dx * o.ux + dz * o.uz;
    const lz = -dx * o.uz + dz * o.ux;
    const px = o.hx + CLEARANCE - Math.abs(lx);
    const pz = o.hz + CLEARANCE - Math.abs(lz);
    const py = o.h + CLEARANCE - p.y;
    if (px <= 0 || pz <= 0 || py <= 0) continue;
    if (py <= px && py <= pz) {
      p.y = o.h + CLEARANCE;
      roof = true;
    } else if (px <= pz) {
      const s = Math.sign(lx) || 1;
      p.x += s * px * o.ux;
      p.z += s * px * o.uz;
    } else {
      const s = Math.sign(lz) || 1;
      p.x -= s * pz * o.uz;
      p.z += s * pz * o.ux;
    }
  }
  return roof;
}

/**
 * The three camera modes (keys 1–3):
 *  orbit       OrbitControls, for development and fixed viewpoints.
 *  fly         WASD + mouse look (click to capture the pointer), Space/E up, C/Q down,
 *              Shift boost, wheel changes speed. Slides along walls and roofs, never
 *              entering a building.
 *  flythrough  the layout's cinematic loop, a pure function of the shared clock.
 * Switching keeps the current camera pose, so any mode can pick up where another left off.
 */
export class CameraRig {
  mode: CameraMode = 'orbit';
  /** Buildings the free-fly camera cannot enter (see obstaclesFrom). */
  obstacles: Obstacle[] = [];
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private speed = FLY.speed;
  /** Clock time the flythrough loop started at (0 when opened with ?camera=flythrough). */
  private flyStart = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly target = new THREE.Vector3();

  constructor(
    private readonly clock: { readonly time: number },
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly controls: OrbitControls,
    private readonly path: FlythroughPath | null,
    private readonly onChange: (mode: CameraMode) => void = () => {},
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('click', () => {
      if (this.mode === 'fly' && document.pointerLockElement !== dom) dom.requestPointerLock?.();
    });
    document.addEventListener('mousemove', (e) => {
      if (this.mode !== 'fly' || document.pointerLockElement !== dom) return;
      this.euler.y -= e.movementX * FLY.look;
      this.euler.x = THREE.MathUtils.clamp(this.euler.x - e.movementY * FLY.look, -1.55, 1.55);
      this.camera.quaternion.setFromEuler(this.euler);
    });
    dom.addEventListener('wheel', (e) => {
      if (this.mode !== 'fly') return;
      e.preventDefault();
      this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY > 0 ? 1 / 1.2 : 1.2), FLY.minSpeed, FLY.maxSpeed);
    }, { passive: false });
  }

  get flySpeed(): number {
    return this.speed;
  }

  /** Switch modes. `fromStart` runs the flythrough from its t = 0 instead of from now. */
  setMode(mode: CameraMode, fromStart = false): void {
    if (mode === 'flythrough' && !this.path) return;
    const prev = this.mode;
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    this.velocity.set(0, 0, 0);
    if (mode !== 'fly' && document.pointerLockElement === this.dom) document.exitPointerLock();
    if (mode === 'orbit' && prev !== 'orbit') {
      this.camera.getWorldDirection(this.tmp);
      this.controls.target.copy(this.camera.position).addScaledVector(this.tmp, ORBIT_TARGET);
      this.controls.update();
    }
    if (mode === 'fly') this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    if (mode === 'flythrough') this.flyStart = fromStart ? 0 : this.clock.time;
    this.onChange(mode);
  }

  /** `delta`: real seconds since the last frame (free-fly moves even when the clock is frozen). */
  update(delta: number): void {
    if (this.mode === 'orbit') {
      this.controls.update();
    } else if (this.mode === 'flythrough' && this.path) {
      this.path.sample(this.clock.time - this.flyStart, this.camera.position, this.target);
      this.camera.lookAt(this.target);
    } else if (this.mode === 'fly') {
      this.move(Math.min(delta, 0.1));
    }
  }

  private move(dt: number): void {
    const k = this.keys;
    const want = this.tmp.set(
      (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyC') || k.has('KeyQ') ? 1 : 0),
      (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0),
    );
    // Forward/strafe follow the view (pitch included); up/down stay vertical.
    const up = want.y;
    want.y = 0;
    want.applyQuaternion(this.camera.quaternion);
    want.y += up;
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(this.speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? FLY.boost : 1));
    this.velocity.lerp(want, 1 - Math.exp(-FLY.response * dt));
    this.camera.position.addScaledVector(this.velocity, dt);
    this.camera.position.y = Math.max(this.camera.position.y, FLY.floor);
    if (pushOut(this.camera.position, this.obstacles)) this.velocity.y = Math.max(this.velocity.y, 0);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    if (down && !e.repeat && /^Digit[123]$/.test(e.code)) {
      this.setMode(CAMERA_MODES[Number(e.code.slice(5)) - 1]);
      return;
    }
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (this.mode === 'fly' && ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
  }
}
