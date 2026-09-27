import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FlythroughPath } from '../systems/flythrough';
import type { Layout, LayoutAnchor } from '../systems/layout';
import viewpoints from './viewpoints.json';

export interface Viewpoint {
  name: string;
  /**
   * Layout anchor the camera is relative to (layout.anchors). In the anchor's frame, +x is its
   * forward axis, +y up, +z to the right when facing forward. Absent: world coordinates.
   */
  anchor?: string;
  /** Fixed camera; also the fallback for flythrough viewpoints when the layout has no spline. */
  position: [number, number, number];
  target: [number, number, number];
  /**
   * 0..1 through the flythrough loop's duration (time, not distance: the camera is slower in
   * the canyon). Overrides position/target when the layout has a flythrough.
   */
  flythrough?: number;
}

export const VIEWPOINTS = viewpoints as Viewpoint[];

function toWorld(p: [number, number, number], frame?: LayoutAnchor): THREE.Vector3 {
  if (!frame) return new THREE.Vector3(...p);
  const [fx, fz] = frame.x;
  const [ox, oy, oz] = frame.origin;
  // right = forward × up = (-fz, fx) on the ground
  return new THREE.Vector3(ox + fx * p[0] - fz * p[2], oy + p[1], oz + fz * p[0] + fx * p[2]);
}

export function applyViewpoint(
  name: string,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  layout: Layout | null = null,
  path: FlythroughPath | null = null,
): boolean {
  const vp = VIEWPOINTS.find((v) => v.name === name);
  if (!vp) return false;
  if (vp.flythrough !== undefined && path) {
    path.sample(THREE.MathUtils.clamp(vp.flythrough, 0, 1) * path.duration, camera.position, controls.target);
  } else {
    const frame = vp.anchor ? layout?.anchors?.[vp.anchor] : undefined;
    camera.position.copy(toWorld(vp.position, frame));
    controls.target.copy(toWorld(vp.target, frame));
  }
  controls.update();
  return true;
}
