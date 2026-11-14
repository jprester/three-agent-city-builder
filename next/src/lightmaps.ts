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

/** RGB stores fluorescent irradiance at 0, 8 and 16 m, not colour. Sampling by height
 * keeps platform lighting off the road and lets tubes reveal the structure around them.
 * This is deliberately soft spill, not an occlusion/shadow solution. */
export function createFixtureMap(lights: FixtureLight[], rect: THREE.Vector4): THREE.Texture {
  const { canvas, g, scale } = canvasFor(rect);
  for (const l of lights) {
    for (let band = 0; band < 3; band++) {
      const dy = Math.abs(l.y - band * 8);
      const reach = l.radius * 1.5;
      if (dy >= reach) continue;
      const radius = Math.sqrt(reach * reach - dy * dy) * scale;
      const gain = Math.min(1, l.strength * 0.55 / (1 + (dy / 4) ** 2));
      const rgb = [0, 0, 0];
      rgb[band] = 255;
      const cx = (l.x - rect.x) * scale, cz = (l.z - rect.y) * scale;
      const grad = g.createRadialGradient(cx, cz, 0, cx, cz, radius);
      grad.addColorStop(0, `rgba(${rgb.join(',')},${gain})`);
      grad.addColorStop(0.35, `rgba(${rgb.join(',')},${gain * 0.5})`);
      grad.addColorStop(1, `rgba(${rgb.join(',')},0)`);
      g.fillStyle = grad;
      g.fillRect(cx - radius, cz - radius, radius * 2, radius * 2);
    }
  }
  return finish(canvas, false);
}
