import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
  /** 0..1 along the layout's flythrough spline. Overrides position/target when the spline exists. */
  flythrough?: number;
}

export const VIEWPOINTS = viewpoints as Viewpoint[];

/** Distance in meters ahead along the spline tangent that the camera looks at. */
const LOOK_AHEAD = 20;

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
): boolean {
  const vp = VIEWPOINTS.find((v) => v.name === name);
  if (!vp) return false;
  const spline = layout?.flythrough;
  if (vp.flythrough !== undefined && spline && spline.points.length >= 2) {
    const closed = spline.closed ?? true;
    const curve = new THREE.CatmullRomCurve3(spline.points.map((p) => new THREE.Vector3(...p)), closed);
    const t = THREE.MathUtils.clamp(vp.flythrough, 0, 1);
    camera.position.copy(curve.getPointAt(t));
    if (spline.look?.length === spline.points.length) {
      // The look track shares the path's parameterization, so sample it at the same u.
      const look = new THREE.CatmullRomCurve3(spline.look.map((p) => new THREE.Vector3(...p)), closed);
      controls.target.copy(look.getPoint(curve.getUtoTmapping(t, 0)));
    } else {
      controls.target.copy(camera.position).addScaledVector(curve.getTangentAt(t), LOOK_AHEAD);
    }
  } else {
    const frame = vp.anchor ? layout?.anchors?.[vp.anchor] : undefined;
    camera.position.copy(toWorld(vp.position, frame));
    controls.target.copy(toWorld(vp.target, frame));
  }
  controls.update();
  return true;
}
