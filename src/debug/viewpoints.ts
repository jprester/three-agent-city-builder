import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import viewpoints from './viewpoints.json';

export interface Viewpoint {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
}

export const VIEWPOINTS = viewpoints as Viewpoint[];

export function applyViewpoint(name: string, camera: THREE.PerspectiveCamera, controls: OrbitControls): boolean {
  const vp = VIEWPOINTS.find((v) => v.name === name);
  if (!vp) return false;
  camera.position.set(...vp.position);
  controls.target.set(...vp.target);
  controls.update();
  return true;
}
