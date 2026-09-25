import * as THREE from 'three';
import type { Layout } from '../systems/layout';

/** Meters per lamp-map texel target; the map is capped at MAX_SIZE texels per side. */
const METERS_PER_TEXEL = 0.5;
const MAX_SIZE = 2048;
const MARGIN = 60;
/** Radius of a lamp's light pool on the ground, meters. */
const POOL_RADIUS = 11;

export interface LampMap {
  texture: THREE.CanvasTexture;
  /** minX, minZ, 1/sizeX, 1/sizeZ in world meters (for shaders). */
  rect: THREE.Vector4;
}

/**
 * Top-down map of street-light intensity: one additive radial falloff per lamp in the
 * layout, drawn once on a canvas. The ground reads it for light pools, facades for the
 * glow on their lower floors, instead of hundreds of real lights.
 */
export function createLampMap(layout: Layout): LampMap {
  const [w, d] = layout.size;
  const sizeX = w + 2 * MARGIN, sizeZ = d + 2 * MARGIN;
  const scale = Math.min(1 / METERS_PER_TEXEL, MAX_SIZE / Math.max(sizeX, sizeZ));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(sizeX * scale);
  canvas.height = Math.ceil(sizeZ * scale);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = 'lighter';
  const minX = -w / 2 - MARGIN, minZ = -d / 2 - MARGIN;
  for (const [x, z, angle] of layout.lamps ?? []) {
    // The head hangs ~1.8 m out over the road from the pole.
    const cx = (x + Math.sin(angle) * 1.8 - minX) * scale;
    const cz = (z + Math.cos(angle) * 1.8 - minZ) * scale;
    const r = POOL_RADIUS * scale;
    const grad = g.createRadialGradient(cx, cz, 0, cx, cz, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(cx - r, cz - r, 2 * r, 2 * r);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, rect: new THREE.Vector4(minX, minZ, 1 / sizeX, 1 / sizeZ) };
}
