import * as THREE from 'three';
import palette from '../../../art/style/palette.json';
import { mulberry32, weightedChoice } from '../../../art/layouts/lib/rng.mjs';
import type { Layout } from '../../systems/layout';
import { BRANDS, type SignAtlas, type SignDesign } from './atlas';
import { artWeight, coverRect, SRC, type ArtEntry, type SignArt } from './art';

export interface SignUniforms {
  uTime: { value: number };
  uAtlas: { value: THREE.Texture | null };
  uSignGain: { value: number };
  uNeonV: { value: THREE.Texture | null };
  uNeonH: { value: THREE.Texture | null };
  uPosterP: { value: THREE.Texture | null };
  uPosterL: { value: THREE.Texture | null };
}

// Brand colors (tower logo families): one fixed tube color per brand.
const BRAND_COLORS = ['sign_red', 'sign_amber', 'tungsten', 'sign_red', 'fluorescent', 'sodium', 'sign_cyan', 'sign_amber'];
/** Share of signs showing the human's artwork rather than a stroke-drawn design. */
const IMAGE_SHARE = { street: 0.6, tower: 0.85 };

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

export function createSigns(layout: Layout, atlas: SignAtlas, art: SignArt, uniforms: SignUniforms): { mesh: THREE.InstancedMesh; brackets: THREE.InstancedMesh | null; lights: SignLight[] } | null {
  const signs = layout.signs ?? [];
  if (!signs.length) return null;
  const lights: SignLight[] = [];
  const uses = new Map<ArtEntry, number>();
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
    const tall = s.size[1] > s.size[0] * 1.3;
    const aspect = s.size[0] / s.size[1];
    // Weighted by warmth, divided by how often each image is already used, so a few warm
    // signs do not repeat down the whole street.
    const w = (e: ArtEntry) => artWeight(e) / (1 + 1.5 * (uses.get(e) ?? 0));
    const pickArt = (list: ArtEntry[]) => {
      let r = rng() * list.reduce((a, e) => a + w(e), 0);
      let pick = list[list.length - 1];
      for (const e of list) if ((r -= w(e)) <= 0) { pick = e; break; }
      uses.set(pick, (uses.get(pick) ?? 0) + 1);
      return pick;
    };
    let source: number, design: SignDesign | null = null, image: ArtEntry | null = null;
    if (s.brand !== undefined) {
      const brand = s.brand;
      design = (tall ? atlas.blades : atlas.panels).find((d) => d.brand === brand % BRANDS)!;
      source = 0;
    } else if (s.art === 'landscape') {
      image = pickArt(art.entries.posterL);
      source = SRC.posterL;
    } else if (rng() < (s.inset !== undefined ? IMAGE_SHARE.tower : IMAGE_SHARE.street)) {
      image = pickArt(tall ? art.entries.neonV : art.entries.neonH);
      source = tall ? SRC.neonV : SRC.neonH;
    } else {
      const pool = (tall ? atlas.blades : atlas.panels).filter((d) => d.brand === undefined);
      design = pool[Math.floor(rng() * pool.length)];
      source = design.boxed ? 1 : 0;
    }
    (image ? coverRect(image, aspect) : design!.rect).toArray(rect, i * 4);
    const tubeCol = s.brand !== undefined ? col(BRAND_COLORS[s.brand % BRANDS]) : col(weightedChoice(rng, TUBE_COLORS));
    const backCol = col(weightedChoice(rng, BOX_COLORS));
    tubeCol.toArray(tube, i * 3);
    backCol.toArray(back, i * 3);
    const lightCol = image ? new THREE.Color(...image.color) : design!.boxed ? backCol.clone().lerp(new THREE.Color(1, 1, 1), 0.3) : tubeCol;
    lights.push({
      x: s.position[0], y: s.position[1], z: s.position[2],
      size: Math.max(s.size[0], s.size[1]),
      color: lightCol,
      strength: image ? (source >= SRC.posterP ? 0.5 : 0.9) : design!.boxed ? 0.6 : 1,
    });
    const branded = s.brand !== undefined;
    const broken = !branded && !image && rng() < 0.3 ? 0.15 + 0.35 * rng() : 0;
    const flicker = !branded && rng() < (image ? 0.05 : 0.2) ? 0.1 + 0.3 * rng() : 0;
    params.set([source, rng(), broken, flicker], i * 4);
    m.compose(new THREE.Vector3(...s.position), q.setFromAxisAngle(up, s.rotationY), new THREE.Vector3(...s.size));
    mesh.setMatrixAt(i, m);
  });
  geometry.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geometry.setAttribute('aTube', new THREE.InstancedBufferAttribute(tube, 3));
  geometry.setAttribute('aBack', new THREE.InstancedBufferAttribute(back, 3));
  geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh, brackets: createBrackets(signs), lights };
}

const metal = col('metal_dark');

/**
 * Mounting hardware for projecting blades: a hanger arm from the wall along the sign's top
 * edge and a short stub at its bottom corner. In a blade's frame the wall is at local
 * +x = width/2 + 0.3 (layout: blades stand 0.3 m off the facade). One instanced draw.
 */
function createBrackets(signs: NonNullable<Layout['signs']>): THREE.InstancedMesh | null {
  const blades = signs.filter((s) => s.kind === 'blade');
  if (!blades.length) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: metal, roughness: 0.55, metalness: 0.5 }), blades.length * 2);
  mesh.name = 'sign-brackets';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  blades.forEach((s, i) => {
    const [w, h] = s.size;
    q.setFromAxisAngle(up, s.rotationY);
    const wall = w / 2 + 0.3;
    // [local x0, local x1, local y, thickness]
    const bars: [number, number, number, number][] = [[-w / 2 + 0.05, wall, h / 2 + 0.09, 0.07], [w / 2 - 0.05, wall, -h / 2 + 0.2, 0.06]];
    bars.forEach(([x0, x1, y, t], k) => {
      p.set((x0 + x1) / 2, y, 0).applyQuaternion(q).add(new THREE.Vector3(...s.position));
      m.compose(p, q, new THREE.Vector3(x1 - x0, t, t));
      mesh.setMatrixAt(i * 2 + k, m);
    });
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

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
flat varying vec3 vTube;
flat varying vec3 vBack;
flat varying vec4 vParams;`)
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
uniform sampler2D uNeonV, uNeonH, uPosterP, uPosterL;
varying vec2 vSignUv;
varying float vFace;
flat varying vec3 vTube;
flat varying vec3 vBack;
flat varying vec4 vParams;
float sHash(float x) { return fract(sin(x * 127.1) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vFace > 0.5 && vParams.x > 1.5) {
  // Artwork (neon photos / ads): emissive as drawn; whole-sign flicker for a rare few.
  int src = int(vParams.x + 0.5);
  vec3 img = src == 2 ? texture2D(uNeonV, vSignUv).rgb : src == 3 ? texture2D(uNeonH, vSignUv).rgb
           : src == 4 ? texture2D(uPosterP, vSignUv).rgb : texture2D(uPosterL, vSignUv).rgb;
  float fl = vParams.w > 0.0 ? step(0.3, fract(sin(floor(uTime * 9.0) * 91.7 + vParams.y * 1000.0) * 4375.85)) : 1.0;
  float gain = src <= 3 ? 2.1 : 1.0;
  diffuseColor.rgb = img * 0.08;
  totalEmissiveRadiance += img * gain * fl * uSignGain;
} else if (vFace > 0.5) {
  vec4 s = texture2D(uAtlas, vSignUv);
  float glow = textureLod(uAtlas, vSignUv, 3.5).r;
  // Decode stroke IDs before filtering: coverage-filtered IDs produce random edge speckles.
  vec2 atlasSize = vec2(textureSize(uAtlas, 0));
  vec4 stroke = texelFetch(uAtlas, ivec2(clamp(vSignUv * atlasSize, vec2(0.0), atlasSize - 1.0)), 0);
  float id = floor(stroke.g / max(stroke.r, 1.0 / 255.0) * 255.0 + 0.5);
  float seed = vParams.y * 1000.0;
  // Broken tubes stay dark; a few strokes flicker on the shared clock.
  float alive = step(vParams.z, sHash(id + seed));
  float fl = vParams.w > 0.0 && sHash(id * 3.1 + seed) < vParams.w
    ? step(0.35, fract(sin(floor(uTime * 12.0 + id) * 91.7 + seed) * 4375.85)) : 1.0;
  float footprint = max(length(dFdx(vSignUv * atlasSize)), length(dFdy(vSignUv * atlasSize)));
  float on = mix(alive * fl, 1.0 - vParams.z, smoothstep(1.0, 3.0, footprint));
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
  material.customProgramCacheKey = () => 'signs-v3';
  return material;
}
