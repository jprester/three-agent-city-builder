import * as THREE from 'three/webgpu';
import type { FixtureLight, SignLight } from './build';
import type { Plan } from './plan';

const TEXELS_PER_METER = 2, MAX_SIZE = 2048, MARGIN = 60, POOL_RADIUS = 11;

/** World rectangle the top-down maps cover: minX, minZ, 1/sizeX, 1/sizeZ. */
export function mapRect(plan: Plan): THREE.Vector4 {
  return new THREE.Vector4(-plan.size.x - MARGIN, -plan.size.z - MARGIN, 1 / (2 * (plan.size.x + MARGIN)), 1 / (2 * (plan.size.z + MARGIN)));
}

function canvasFor(rect: THREE.Vector4) {
  const sizeX = 1 / rect.z, sizeZ = 1 / rect.w;
  const scale = Math.min(TEXELS_PER_METER, MAX_SIZE / Math.max(sizeX, sizeZ));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(sizeX * scale);
  canvas.height = Math.ceil(sizeZ * scale);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = 'lighter';
  return { canvas, g, scale };
}

function finish(canvas: HTMLCanvasElement, srgb: boolean) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

/**
 * The lighting model's first half: every street lamp as an additive radial falloff on a
 * top-down map, drawn once. Ground, walls, kit, rain and haze all read it; there are no light
 * objects for lamps anywhere in the scene.
 */
export function createLampMap(plan: Plan, rect: THREE.Vector4): THREE.Texture {
  const { canvas, g, scale } = canvasFor(rect);
  for (const [x, z, dx, dz] of plan.lamps) {
    const cx = (x + dx * 1.8 - rect.x) * scale, cz = (z + dz * 1.8 - rect.y) * scale, r = POOL_RADIUS * scale;
    const grad = g.createRadialGradient(cx, cz, 0, cx, cz, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(cx - r, cz - r, 2 * r, 2 * r);
  }
  return finish(canvas, false);
}

/** The second half: each sign's coloured glow on the same rectangle. */
export function createSignMap(lights: SignLight[], rect: THREE.Vector4): THREE.Texture {
  const { canvas, g, scale } = canvasFor(rect);
  for (const l of lights) {
    const c = l.color.clone().convertLinearToSRGB();
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    const cx = (l.x - rect.x) * scale, cz = (l.z - rect.y) * scale, r = (5 + l.size * 1.1) * scale;
    const grad = g.createRadialGradient(cx, cz, 0, cx, cz, r);
    grad.addColorStop(0, `rgba(${rgb},${(0.55 * l.strength).toFixed(3)})`);
    grad.addColorStop(0.4, `rgba(${rgb},${(0.22 * l.strength).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(cx - r, cz - r, 2 * r, 2 * r);
  }
  return finish(canvas, true);
}

export interface FixtureMap {
  texture: THREE.Texture;
  /** Mounting height of the fixtures in each channel (R, G, B), meters. */
  heights: THREE.Vector3;
}

/** Radius of a fixture's footprint as baked (m): the light right under it. Further down the shader widens it. */
const FIXTURE_RADIUS = 3;

/**
 * Downward fixtures (tubes under decks, canopies and bridges) in three layers by mounting
 * height, one per channel: each channel is where that layer's fixtures are, as tight pools.
 * The shader does the rest per pixel (see fixtureSpill in tsl.ts): nothing above a layer is
 * lit by it, the pool widens and thins with the drop below it, and surfaces are weighted by
 * the way they face. A light map still cannot see slabs in between, so light from a high
 * layer reaches the ground under a lower deck, much weakened by the drop.
 */
export function createFixtureMap(lights: FixtureLight[], rect: THREE.Vector4): FixtureMap {
  const { canvas, g, scale } = canvasFor(rect);
  // Three layers: split the sorted mounting heights at their two widest gaps.
  const ys = [...new Set(lights.map((l) => +l.y.toFixed(2)))].sort((a, b) => a - b);
  const gaps = ys.slice(1).map((y, i) => ({ at: (y + ys[i]) / 2, size: y - ys[i] })).sort((a, b) => b.size - a.size).slice(0, 2).map((x) => x.at).sort((a, b) => a - b);
  const layerOf = (y: number) => gaps.filter((c) => y > c).length;
  const heights = [0, 1, 2].map((k) => {
    const group = lights.filter((l) => layerOf(l.y) === k).map((l) => l.y).sort((a, b) => a - b);
    return group.length ? group[Math.floor(group.length / 2)] : 0;   // the layer's median mounting height
  });
  for (const l of lights) {
    const k = layerOf(l.y);
    // A fixture mounted above its layer's height would read too bright on the ground: thin it by the inverse square.
    const correction = Math.min(1, (heights[k] / l.y) ** 2);
    const alpha = Math.min(0.5, l.strength * 0.32 * correction);
    const rgb = [0, 0, 0];
    rgb[k] = 255;
    const cx = (l.x - rect.x) * scale, cz = (l.z - rect.y) * scale, r = FIXTURE_RADIUS * scale;
    const grad = g.createRadialGradient(cx, cz, 0, cx, cz, r);
    grad.addColorStop(0, `rgba(${rgb.join(',')},${alpha})`);
    grad.addColorStop(0.5, `rgba(${rgb.join(',')},${alpha * 0.45})`);
    grad.addColorStop(1, `rgba(${rgb.join(',')},0)`);
    g.fillStyle = grad;
    g.fillRect(cx - r, cz - r, r * 2, r * 2);
  }
  return { texture: finish(canvas, false), heights: new THREE.Vector3(heights[0], heights[1], heights[2]) };
}
