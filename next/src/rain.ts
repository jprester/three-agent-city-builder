import * as THREE from 'three/webgpu';
import type { Roof } from './build';
import {
  Fn, If, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cross, exp, float, instanceIndex, instancedArray,
  length, max, mix, mod, normalize, screenSize, select, smoothstep, sqrt, step, texture, uniform, varying, vec2, vec3, vec4,
  P, mapUv, type N,
} from './tsl';

export interface RainInputs {
  count: number;
  lampMap: THREE.Texture;
  signMap: THREE.Texture;
  /** minX, minZ, 1/sizeX, 1/sizeZ of the lamp and sign maps (uniform vec4). */
  lampRect: N;
  /** World rectangle of the maps, for the roof-height map drawn on the same rectangle. */
  rect: THREE.Vector4;
  /** Camera position at start: the drops are scattered in a box around it. */
  eye: THREE.Vector3;
}

export interface Rain {
  mesh: THREE.Mesh;
  /**
   * Advance the simulation by `dt` seconds around `camera` (one compute pass). A frozen clock
   * (dt 0) leaves the drops where the warm-up put them, so captures repeat exactly.
   */
  update(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, dt: number, amount: number): void;
}

const HEIGHT_TEXELS = 1024;
/** Seconds a drop spends as a splash where it landed before it falls again. */
const SPLASH_TIME = 0.14;
/** Simulated before the first frame, so a frozen-time capture shows settled rain. */
const WARMUP_STEPS = 48, WARMUP_DT = 1 / 20;
const BOX = new THREE.Vector3(60, 36, 60);
const WIND = new THREE.Vector2(1.6, 0.7);
const SPEED = 9.5;

/** Top-down heights of everything rain can land on, on the lamp map's world rectangle. Open ground is 0. */
function createHeightMap(roofs: Roof[], rect: THREE.Vector4): THREE.DataTexture {
  const n = HEIGHT_TEXELS;
  const data = new Float32Array(n * n);
  const sx = n * rect.z, sz = n * rect.w;   // texels per meter
  for (const r of roofs) {
    const x0 = Math.max(0, Math.round((r.x0 - rect.x) * sx)), x1 = Math.min(n, Math.round((r.x1 - rect.x) * sx));
    const z0 = Math.max(0, Math.round((r.z0 - rect.y) * sz)), z1 = Math.min(n, Math.round((r.z1 - rect.y) * sz));
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) data[z * n + x] = Math.max(data[z * n + x], r.h);
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Rain as a GPU simulation. Each drop is a particle with a position and a state in a storage
 * buffer; a compute pass moves it every frame, wraps it around the camera, and tests it against
 * the roof-height map. A drop that reaches a roof, the viaduct or the street stops there as a
 * splash for a moment, then falls again from the top of the box: it is dry under the tracks
 * and the canopies, and surfaces near the camera sparkle where rain lands.
 */
export function createRain(roofs: Roof[], inp: RainInputs): Rain {
  const count = inp.count;
  // Deterministic scatter (no Math.random: screenshots must repeat exactly).
  let a = 0x9e3779b9;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const seedData = new Float32Array(count * 4), stateData = new Float32Array(count * 4);
  const k0 = THREE.MathUtils.clamp(inp.eye.y / 30, 1, 10);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) seedData[i * 4 + c] = rnd();
    stateData[i * 4] = inp.eye.x + (seedData[i * 4] - 0.5) * BOX.x * k0;
    stateData[i * 4 + 1] = inp.eye.y + (seedData[i * 4 + 1] - 0.5) * BOX.y * k0;
    stateData[i * 4 + 2] = inp.eye.z + (seedData[i * 4 + 2] - 0.5) * BOX.z * k0;
  }
  // xyz: world position; w: seconds left as a splash (0 while falling).
  const state = instancedArray(stateData, 'vec4') as N;
  const seeds = instancedArray(seedData, 'vec4') as N;
  const heightTex = texture(createHeightMap(roofs, inp.rect)) as N;
  const lampTex = texture(inp.lampMap) as N, signTex = texture(inp.signMap) as N;
  const uDt = uniform(0), uAmount = uniform(1), uProjY = uniform(1), uEye = uniform(inp.eye.clone());
  const box = vec3(BOX.x, BOX.y, BOX.z), wind = vec2(WIND.x, WIND.y);
  // Higher cameras: a bigger box (same count, so sparser) with longer streaks.
  const boxScale = (eyeY: N): N => clamp(eyeY.div(30), 1, 10);
  const velocityOf = (seed: N): N => vec3(wind.x, seed.x.mul(0.4).add(0.8).mul(-SPEED), wind.y);
  const roofAt = (xz: N): N => {
    const uv = mapUv(xz, inp.lampRect);
    const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
    return heightTex.sample(uv).level(0).r.mul(inside);
  };

  const simulate = Fn(() => {
    const s = state.element(instanceIndex);
    const seed = seeds.element(instanceIndex);
    const size = box.mul(boxScale(uEye.y)).toVar();
    If(s.w.greaterThan(0), () => {
      // A splash: wait it out, then fall again from the top of the box.
      s.w.subAssign(uDt);
      If(s.w.lessThanEqual(0), () => {
        s.w.assign(0);
        s.y.assign(uEye.y.add(size.y.mul(0.5)));
      });
    }).Else(() => {
      const moved = s.xyz.add(velocityOf(seed).mul(uDt));
      // Wrap around the camera in all three axes, as the stateless rain does.
      const p = uEye.add(mod(moved.sub(uEye).add(size.mul(0.5)), size).sub(size.mul(0.5))).toVar();
      const roof = roofAt(p.xz);
      If(p.y.lessThan(roof), () => {
        p.y.assign(roof);
        s.w.assign(SPLASH_TIME);
      });
      s.xyz.assign(p);
    });
  });
  const computeNode = simulate().compute(count);

  // --- drawing: one camera-facing quad per drop, a streak along its velocity or a splash ---
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const corner = attribute('position', 'vec3') as N;
  const s = state.element(instanceIndex), seed = seeds.element(instanceIndex);
  const k = boxScale(cameraPosition.y);
  const size = box.mul(k);
  const base = s.xyz;
  const rel = base.sub(cameraPosition);
  const splash = step(1e-4, s.w);
  const life = s.w.div(SPLASH_TIME);   // 1 at impact, 0 when it ends
  const dir = normalize(mix(normalize(velocityOf(seed)), vec3(0, 1, 0), splash));
  const side = normalize(cross(dir, normalize(rel.negate())));
  const streakLen = mix(0.12, 0.5, seed.y.mul(seed.y)).mul(mix(1, k, 0.6));
  const len = mix(streakLen, life.oneMinus().mul(0.05).add(0.03), splash);
  const thin = mix(0.003, 0.007, seed.z);
  const width0 = mix(thin, life.oneMinus().mul(0.05).add(0.02), splash);
  // At least one pixel wide; the widened streak dims by the square root, so distant rain
  // still reads as faint lines rather than nothing.
  const px = length(rel).mul(2).div(uProjY.mul(screenSize.y));
  const drawn = max(width0, px);
  const world = base.add(dir.mul(corner.y).mul(len)).add(side.mul(corner.x).mul(drawn));
  const e = abs(rel).div(size.mul(0.5));
  const edge = smoothstep(0.7, 1, max(max(e.x, e.y), e.z)).oneMinus().mul(smoothstep(3.5, 8, length(rel)));
  const falling = step(seed.y, uAmount);
  const vFade = varying(edge.mul(falling).mul(mix(float(1), life.mul(1.6), splash))) as N;
  const vBright = varying(mix(0.3, 1, seed.z.mul(seed.z)).mul(sqrt(width0.div(drawn))).mul(mix(1, 2.2, k.sub(1).div(9)))) as N;
  const vQuad = varying(corner.xy) as N, vWorld = varying(world) as N;

  const color = Fn(() => {
    const uv = mapUv(vWorld.xz, inp.lampRect);
    const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
    const lamp = lampTex.sample(uv).level(0).r.mul(inside).mul(exp(max(vWorld.y.sub(4), 0).div(-12)));
    const sign = signTex.sample(uv).level(0).rgb.mul(inside).mul(exp(max(vWorld.y.sub(8), 0).div(-14)));
    // From higher up, the city's broad glow below (coarse lamp map) lights the rain too.
    const city = lampTex.sample(uv).level(6).r.mul(inside).mul(exp(max(vWorld.y, 0).div(-450)));
    const light = P('haze').mul(0.8).add(P('sodium').mul(lamp.mul(2).add(city.mul(3)))).add(sign.mul(1.6));
    const streak = abs(vQuad.x).oneMinus().mul(smoothstep(0, 0.3, vQuad.y)).mul(smoothstep(0.7, 1, vQuad.y).oneMinus());
    return light.mul(streak).mul(vFade).mul(vBright).mul(0.5).mul(select(vWorld.y.lessThan(0), float(0), float(1)));
  });

  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  material.name = 'rain';
  material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1));
  material.colorNode = color();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'rain';
  mesh.count = count;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  let warmed = false;
  return {
    mesh,
    update(renderer, camera, dt, amount) {
      uAmount.value = amount;
      uProjY.value = camera.projectionMatrix.elements[5];
      uEye.value.setFromMatrixPosition(camera.matrixWorld);
      if (!warmed) {
        // Settle the initial scatter: drops inside buildings land on the roofs, splashes appear.
        warmed = true;
        uDt.value = WARMUP_DT;
        for (let i = 0; i < WARMUP_STEPS; i++) renderer.compute(computeNode);
      }
      uDt.value = Math.min(dt, 0.1);
      if (dt > 0) renderer.compute(computeNode);
    },
  };
}
