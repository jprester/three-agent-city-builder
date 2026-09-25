import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Layout } from '../systems/layout';
import viewpoints from './viewpoints.json';

export interface Viewpoint {
  name: string;
  /** Fixed camera; also the fallback for flythrough viewpoints when the layout has no spline. */
  position: [number, number, number];
  target: [number, number, number];
  /** 0..1 along the layout's flythrough spline. Overrides position/target when the spline exists. */
  flythrough?: number;
}

export const VIEWPOINTS = viewpoints as Viewpoint[];

/** Distance in meters ahead along the spline tangent that the camera looks at. */
const LOOK_AHEAD = 20;

export function applyViewpoint(
  name: string,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  layout: Layout | null = null,
): boolean {
  const vp = VIEWPOINTS.find((v) => v.name === name);
  if (!vp) return false;
  const spline = layout?.flythrough;
  if (vp.flythrough !== undefined && spline && spline.points.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(spline.points.map((p) => new THREE.Vector3(...p)), spline.closed ?? true);
    const t = THREE.MathUtils.clamp(vp.flythrough, 0, 1);
    camera.position.copy(curve.getPointAt(t));
    controls.target.copy(camera.position).addScaledVector(curve.getTangentAt(t), LOOK_AHEAD);
  } else {
    camera.position.set(...vp.position);
    controls.target.set(...vp.target);
  }
  controls.update();
  return true;
}
