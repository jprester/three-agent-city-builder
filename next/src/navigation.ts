import { Euler, Vector3, type PerspectiveCamera } from 'three/webgpu';
import { SIDEWALK_HEIGHT, sidewalks, type Plan } from './plan';

type Bounds = { x0: number; x1: number; z0: number; z1: number };
export type ManualMode = 'walk' | 'free-fly';

export const EYE_HEIGHT = 1.65;
const WALK_RADIUS = 0.28;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight']);
const contains = (b: Bounds, x: number, z: number, pad = 0) =>
  x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad;

/** Mouse look and manual movement on a clock independent of the city's animation. */
export function createNavigation(camera: PerspectiveCamera, canvas: HTMLCanvasElement, plan: Plan,
  kitObstacles: Bounds[], refreshHint: () => void) {
  const pavements = sidewalks(plan);
  const obstacles = [...plan.buildings, ...kitObstacles];
  const keys = new Set<string>();
  const rotation = new Euler(0, 0, 0, 'YXZ');
  const forward = new Vector3(), right = new Vector3(), move = new Vector3();
  let mode: ManualMode | null = null;
  const locked = () => document.pointerLockElement === canvas;

  let dragging = false;
  let dragged = false;
  canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', (event) => {
    if (!mode || locked() || event.button !== 0) return;
    dragging = true;
    dragged = false;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('lostpointercapture', () => { dragging = false; });
  canvas.addEventListener('click', () => {
    if (!mode || locked() || dragged) return;
    try {
      const request = canvas.requestPointerLock();
      request?.catch(refreshHint);
    } catch {
      refreshHint();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    keys.clear();
    refreshHint();
  });
  document.addEventListener('mousemove', (e) => {
    if (!mode || (!locked() && !dragging)) return;
    if (dragging && (e.movementX || e.movementY)) dragged = true;
    rotation.setFromQuaternion(camera.quaternion, 'YXZ');
    rotation.y -= e.movementX * 0.002;
    rotation.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, rotation.x - e.movementY * 0.002));
    rotation.z = 0;
    camera.quaternion.setFromEuler(rotation);
  });
  window.addEventListener('keydown', (e) => {
    if (!mode || (!locked() && document.activeElement !== canvas) || !MOVEMENT_KEYS.has(e.code)) return;
    e.preventDefault();
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); });
  window.addEventListener('blur', () => { keys.clear(); dragging = false; });
  canvas.addEventListener('blur', () => { keys.clear(); });

  const canWalk = (x: number, z: number) => Math.abs(x) < plan.size.x && Math.abs(z) < plan.size.z
    && !obstacles.some((b) => contains(b, x, z, WALK_RADIUS));
  const floorAt = (x: number, z: number) => pavements.some((b) => contains(b, x, z)) ? SIDEWALK_HEIGHT : 0;

  return {
    locked,
    setMode(next: ManualMode | null) {
      if (next === mode) return;
      mode = next;
      keys.clear();
      dragging = false;
      if (!mode && locked()) document.exitPointerLock();
      if (mode === 'walk') {
        const x = camera.position.x, z = camera.position.z;
        // Switching down from a roof or a platform goes to a known clear sidewalk.
        if (camera.position.y > EYE_HEIGHT + 0.8 || !canWalk(x, z)) {
          camera.position.set(plan.monorail.station[0] - 24, EYE_HEIGHT, -plan.main.half - 2.7);
          camera.lookAt(camera.position.x + 20, EYE_HEIGHT + 2, 0);
        }
        camera.position.y = EYE_HEIGHT + floorAt(camera.position.x, camera.position.z);
      }
    },
    update(dt: number) {
      if (!mode || keys.size === 0) return;
      const boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const axis = (positive: string, negative: string) => Number(keys.has(positive)) - Number(keys.has(negative));
      camera.getWorldDirection(forward);
      right.set(-forward.z, 0, forward.x).normalize();
      if (mode === 'walk') { forward.y = 0; forward.normalize(); }
      move.copy(forward).multiplyScalar(axis('KeyW', 'KeyS')).addScaledVector(right, axis('KeyD', 'KeyA'));
      if (mode === 'free-fly') move.y += Number(keys.has('KeyE') || keys.has('Space')) - Number(keys.has('KeyQ'));
      if (move.lengthSq() === 0) return;
      const speed = mode === 'walk' ? (boost ? 5 : 2.5) : (boost ? 65 : 18);
      move.normalize().multiplyScalar(Math.min(dt, 0.05) * speed);
      const p = camera.position;
      if (mode === 'free-fly') {
        p.add(move);
        p.y = Math.max(EYE_HEIGHT, p.y);
      } else {
        // Resolve axes independently so a glancing collision slides along the wall.
        if (canWalk(p.x + move.x, p.z)) p.x += move.x;
        if (canWalk(p.x, p.z + move.z)) p.z += move.z;
        p.y = EYE_HEIGHT + floorAt(p.x, p.z);
      }
    },
  };
}
