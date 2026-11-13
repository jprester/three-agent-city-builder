import * as THREE from 'three/webgpu';
import {
  Fn, cameraPosition, clamp, exp, floor, fract, fwidth, length, mix, normalize, positionWorld, pow, property, smoothstep, step, texture, uniform, vec2, vec3, vec4,
} from './tsl';
import { P, colorNode, hash21, mapUv, noise2, paletteColor, type N, type PaletteName } from './tsl';

/** Inputs every ground variant shares. */
export interface GroundShared {
  time: N;
  /** Rain strength (src/scene/night.ts): puddle ripples follow it. */
  rain: N;
  lampMap: THREE.Texture;
  signMap: THREE.Texture;
  lampRect: N;
  reflection: THREE.Texture;
  /** World position to reflection-target UV (src/poc/reflection.ts). */
  reflMatrix: THREE.Matrix4;
}

export interface GroundVariant {
  color: PaletteName;
  roughness: number;
  pool?: number;
  wet?: number;
}

/**
 * Wet asphalt: sodium pools from the lamp map, coloured pools from the sign map, puddles, rain
 * ripples, and the planar reflection smeared vertically into the long streaks lights leave on
 * a wet road, strongest in puddles and at grazing angles.
 */
export function createGroundMaterial(v: GroundVariant, s: GroundShared): THREE.MeshStandardNodeMaterial {
  const pool = v.pool ?? 1, wet = v.wet ?? 1;
  const baseColor = colorNode(paletteColor(v.color));
  const SODIUM = P('sodium');
  const lampTex = texture(s.lampMap) as N, signTex = texture(s.signMap) as N, reflTex = texture(s.reflection) as N;
  const uRefl = uniform(s.reflMatrix);
  const pEmit = property('vec3') as N, pRough = property('float') as N;

  const surface = Fn(() => {
    const world = positionWorld;
    const xz = world.xz;
    const puddle = (mix(
      smoothstep(0.55, 0.66, noise2(xz.mul(0.12)).mul(0.65).add(noise2(xz.mul(0.5)).mul(0.35))),
      // Far away the puddle pattern is sub-pixel: fade to its mean coverage instead of mottling.
      0.25, smoothstep(0.03, 0.15, length(fwidth(xz.mul(0.12)))))).toVar();
    const diffuse = baseColor.mul(mix(0.8, 0.45, puddle)).toVar();
    pRough.assign(mix(v.roughness, 0.08, puddle));

    const uv = mapUv(xz, s.lampRect);
    const lamp = lampTex.sample(uv).r;
    const emit = diffuse.mul(SODIUM).mul(lamp).mul(lamp).mul(6 * pool).toVar();
    emit.addAssign(diffuse.mul(signTex.sample(uv).rgb).mul(3 * pool));

    // Wet reflection. The noise normal breaks the mirror up; taps spread along the reflection
    // image's vertical axis give the long smears of lights on wet roads.
    const rp = uRefl.mul(vec4(world.x, 0, world.z, 1));
    // three addresses render-target textures top-down on both backends, the matrix yields v up.
    const ruv = vec2(rp.x.div(rp.w), rp.y.div(rp.w).oneMinus()).toVar();
    const gN = vec2(noise2(xz.mul(1.9)), noise2(xz.mul(1.9).add(11.3))).sub(0.5);
    // Rain ripples: rings expanding in a jittered 0.7 m grid, each on its own cycle (puddles only).
    const cell = floor(xz.div(0.7)).toVar();
    const off = vec2(hash21(cell), hash21(cell.add(5.1))).mul(0.5).add(0.1);
    const ph = fract(s.time.mul(1.1).add(hash21(cell.add(9.7)))).toVar();
    const ringD = length(xz.sub(cell.add(off).mul(0.7)));
    const ringX = ringD.sub(ph.mul(0.3)).div(0.018);
    const ring = exp(ringX.mul(ringX).negate()).mul(ph.oneMinus()).mul(puddle).mul(step(hash21(cell.add(2.9)), s.rain))
      .mul(smoothstep(0.02, 0.08, length(fwidth(xz))).oneMinus());   // gone before it aliases
    ruv.addAssign(ring.mul(0.012));
    ruv.addAssign(gN.mul(vec2(mix(0.003, 0.0012, puddle), mix(0.012, 0.003, puddle))));
    const span = mix(0.08, 0.018, puddle);
    const refl = vec3(0).toVar();
    let weight = 0;
    for (let i = -6; i <= 6; i++) {
      const o = i / 6, w = Math.exp(-Math.abs(o) * 2.2);
      refl.addAssign(reflTex.sample(clamp(ruv.add(vec2(0, span.mul(o))), 0.001, 0.999)).level(0).rgb.mul(w));
      weight += w;
    }
    refl.divAssign(weight);
    const view = normalize(cameraPosition.sub(world));
    const fresnel = pow(clamp(view.y, 0, 1).oneMinus(), 5).mul(0.96).add(0.04).toVar();
    // Asphalt grain breaks up the dull wet film; puddles stay clean.
    const grain = mix(noise2(xz.mul(7)).mul(noise2(xz.mul(2.1).add(3))).mul(0.9).add(0.45), 1, puddle);
    emit.addAssign(refl.mul(grain).mul(mix(0.16, 1, puddle)).mul(fresnel.mul(0.75).add(0.25)).mul(wet).mul(smoothstep(0.5, 8, world.y).oneMinus()));

    pEmit.assign(emit);
    return diffuse;
  });

  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  material.name = `ground-${v.color}`;
  material.colorNode = surface();
  material.roughnessNode = pRough;
  material.emissiveNode = pEmit;
  return material;
}

