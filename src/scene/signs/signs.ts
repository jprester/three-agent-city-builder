import * as THREE from 'three';
import palette from '../../../art/style/palette.json';
import { mulberry32, weightedChoice } from '../../../art/layouts/lib/rng.mjs';
import type { Layout } from '../../systems/layout';
import type { SignAtlas } from './atlas';

export interface SignUniforms {
  uTime: { value: number };
  uAtlas: { value: THREE.Texture | null };
  uSignGain: { value: number };
}

// Mostly practical colors; saturated neon as the accent; cyan kept rare (style bible).
const TUBE_COLORS: Record<string, number> = { sign_red: 32, sign_amber: 25, tungsten: 14, fluorescent: 16, sign_cyan: 3, sodium: 10 };
const BOX_COLORS: Record<string, number> = { fluorescent: 45, tungsten: 30, sign_amber: 15, sign_red: 10 };
const col = (name: string) => new THREE.Color(palette[name as keyof typeof palette]);

/**
 * All signs in one InstancedMesh of unit boxes. The ±Z faces show an atlas design; the rest
 * is a dark metal frame. Per instance: atlas rect, tube/box colors, and flicker/broken-tube
 * parameters, all derived from the sign's layout seed.
 */
/** Where a sign throws light: position, size and its dominant color (for the sign light map). */
export interface SignLight {
  x: number;
  y: number;
  z: number;
  size: number;
  color: THREE.Color;
  strength: number;
}

export function createSigns(layout: Layout, atlas: SignAtlas, uniforms: SignUniforms): { mesh: THREE.InstancedMesh; lights: SignLight[] } | null {
  const signs = layout.signs ?? [];
  if (!signs.length) return null;
  const lights: SignLight[] = [];
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const n = signs.length;
  const rect = new Float32Array(n * 4);
  const tube = new Float32Array(n * 3);
  const back = new Float32Array(n * 3);
  const params = new Float32Array(n * 4);
  const mesh = new THREE.InstancedMesh(geometry, createSignMaterial(uniforms), n);
  mesh.name = 'signs';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);

  signs.forEach((s, i) => {
    const rng = mulberry32((s.seed ^ layout.seed) >>> 0);
    // Tall signs use tall designs, wide ones (panels and arms) wide designs.
    const designs = s.size[1] > s.size[0] ? atlas.blades : atlas.panels;
    const d = designs[Math.floor(rng() * designs.length)];
    d.rect.toArray(rect, i * 4);
    const tubeCol = col(weightedChoice(rng, TUBE_COLORS));
    const backCol = col(weightedChoice(rng, BOX_COLORS));
    tubeCol.toArray(tube, i * 3);
    backCol.toArray(back, i * 3);
    lights.push({
      x: s.position[0], y: s.position[1], z: s.position[2],
      size: Math.max(s.size[0], s.size[1]),
      color: d.boxed ? backCol.clone().lerp(new THREE.Color(1, 1, 1), 0.3) : tubeCol,
      strength: d.boxed ? 0.6 : 1,
    });
    const broken = rng() < 0.3 ? 0.15 + 0.35 * rng() : 0;
    const flicker = rng() < 0.2 ? 0.1 + 0.3 * rng() : 0;
    params.set([d.boxed ? 1 : 0, rng(), broken, flicker], i * 4);
    m.compose(new THREE.Vector3(...s.position), q.setFromAxisAngle(up, s.rotationY), new THREE.Vector3(...s.size));
    mesh.setMatrixAt(i, m);
  });
  geometry.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geometry.setAttribute('aTube', new THREE.InstancedBufferAttribute(tube, 3));
  geometry.setAttribute('aBack', new THREE.InstancedBufferAttribute(back, 3));
  geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh, lights };
}

const metal = col('metal_dark');

function createSignMaterial(uniforms: SignUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: metal, roughness: 0.5, metalness: 0.4 });
  material.name = 'signs';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aRect;
attribute vec3 aTube;
attribute vec3 aBack;
attribute vec4 aParams;
varying vec2 vSignUv;
varying float vFace;
varying vec3 vTube;
varying vec3 vBack;
varying vec4 vParams;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFace = abs(normal.z) > 0.5 ? 1.0 : 0.0;
vSignUv = aRect.xy + uv * aRect.zw;
vTube = aTube;
vBack = aBack;
vParams = aParams;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uSignGain;
varying vec2 vSignUv;
varying float vFace;
varying vec3 vTube;
varying vec3 vBack;
varying vec4 vParams;
float sHash(float x) { return fract(sin(x * 127.1) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vFace > 0.5) {
  vec4 s = texture2D(uAtlas, vSignUv);
  float glow = textureLod(uAtlas, vSignUv, 3.5).r;
  float id = floor(s.g * 255.0 + 0.5);
  float seed = vParams.y * 1000.0;
  // Broken tubes stay dark; a few strokes flicker on the shared clock.
  float alive = step(vParams.z, sHash(id + seed));
  float fl = vParams.w > 0.0 && sHash(id * 3.1 + seed) < vParams.w
    ? step(0.35, fract(sin(floor(uTime * 12.0 + id) * 91.7 + seed) * 4375.85)) : 1.0;
  float on = alive * fl;
  vec3 e;
  if (vParams.x > 0.5) {
    // Backlit box: either a colored face with near-white characters, or a pale face with
    // saturated characters. The face stays dimmer than neon so it does not bloom to a blob.
    bool inverse = fract(vParams.y * 7.3) < 0.5;
    vec3 face = inverse ? vTube * 0.7 : mix(vBack, vec3(1.0), 0.25) * 0.45;
    vec3 ink = inverse ? mix(vTube, vec3(1.0), 0.8) * 1.4 : vTube * 1.5;
    e = s.b * (1.0 - s.r) * face + s.r * ink * on;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5), s.b);
  } else {
    // Neon on a dark board: white-hot core, colored halo; dead tubes read as grey glass.
    e = s.r * mix(vTube, vec3(1.0), 0.12) * 2.4 * on + glow * vTube * 1.4 * on;
    diffuseColor.rgb = mix(diffuseColor.rgb * 0.5, vec3(0.25), s.r * (1.0 - on));
  }
  totalEmissiveRadiance += e * uSignGain;
}`);
  };
  material.customProgramCacheKey = () => 'signs-v1';
  return material;
}
