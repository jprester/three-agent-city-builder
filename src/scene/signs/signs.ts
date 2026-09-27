import * as THREE from 'three';
import palette from '../../../art/style/palette.json';
import { mulberry32, weightedChoice } from '../../../art/layouts/lib/rng.mjs';
import type { Layout } from '../../systems/layout';
import { BRANDS, type SignAtlas, type SignDesign } from './atlas';
import { ART_ENTRIES, atlasCode, type ArtEntry, type SignArt } from './art';

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

export function createSigns(layout: Layout, atlas: SignAtlas, art: SignArt, uniforms: SignUniforms): { mesh: THREE.InstancedMesh; holo: THREE.InstancedMesh | null; brackets: THREE.InstancedMesh | null; lights: SignLight[] } | null {
  const signs = layout.signs ?? [];
  if (!signs.length) return null;
  const lights: SignLight[] = [];
  // Holographic art (dark-background neon and ads) goes to an additive plane mesh; stroke
  // designs and opaque posters stay boxes with a metal frame.
  // Brand wordmarks (tower crowns) are holographic channel letters too: no board.
  const isHolo = (s: (typeof signs)[number]) => s.brand !== undefined || (s.art !== undefined && ART_ENTRIES[s.art].holo);
  const boxes = signs.filter((s) => !isHolo(s));
  const holos = signs.filter(isHolo);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const n = boxes.length;
  const rect = new Float32Array(n * 4);
  const tube = new Float32Array(n * 3);
  const back = new Float32Array(n * 3);
  const params = new Float32Array(n * 4);
  const gains = new Float32Array(n);
  const mesh = new THREE.InstancedMesh(geometry, createSignMaterial(uniforms), n);
  mesh.name = 'signs';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);

  boxes.forEach((s, i) => {
    const rng = mulberry32((s.seed ^ layout.seed) >>> 0);
    let source: number, design: SignDesign | null = null, image: ArtEntry | null = null;
    if (s.art !== undefined) {
      image = ART_ENTRIES[s.art];
      source = atlasCode(image);
    } else {
      const tall = s.stroke ? s.stroke === 'blade' : s.size[1] > s.size[0];
      const pool = (tall ? atlas.blades : atlas.panels).filter((d) => (s.brand !== undefined ? d.brand === s.brand % BRANDS : d.brand === undefined));
      design = pool[Math.floor(rng() * pool.length)];
      source = design.boxed ? 1 : 0;
    }
    // The layout sized the sign to this artwork's aspect: show the whole image, uncropped.
    (image ? new THREE.Vector4(...image.rect) : design!.rect).toArray(rect, i * 4);
    const tubeCol = s.brand !== undefined ? col(BRAND_COLORS[s.brand % BRANDS]) : col(weightedChoice(rng, TUBE_COLORS));
    const backCol = col(weightedChoice(rng, BOX_COLORS));
    tubeCol.toArray(tube, i * 3);
    backCol.toArray(back, i * 3);
    lights.push({
      x: s.position[0], y: s.position[1], z: s.position[2],
      size: Math.max(s.size[0], s.size[1]),
      color: image ? new THREE.Color(...image.color) : design!.boxed ? backCol.clone().lerp(new THREE.Color(1, 1, 1), 0.3) : tubeCol,
      strength: image ? 0.5 : design!.boxed ? 0.6 : 1,
    });
    gains[i] = image?.gain ?? 1;
    const branded = s.brand !== undefined;
    const broken = !branded && !image && rng() < 0.3 ? 0.15 + 0.35 * rng() : 0;
    const flicker = !branded && !image && rng() < 0.2 ? 0.1 + 0.3 * rng() : 0;
    params.set([source, rng(), broken, flicker], i * 4);
    m.compose(new THREE.Vector3(...s.position), q.setFromAxisAngle(up, s.rotationY), new THREE.Vector3(...s.size));
    mesh.setMatrixAt(i, m);
  });
  geometry.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geometry.setAttribute('aTube', new THREE.InstancedBufferAttribute(tube, 3));
  geometry.setAttribute('aBack', new THREE.InstancedBufferAttribute(back, 3));
  geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  geometry.setAttribute('aGain', new THREE.InstancedBufferAttribute(gains, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  const holo = createHolograms(layout, holos, art, atlas, uniforms.uTime, lights);
  return { mesh, holo, brackets: createBrackets(signs), lights };
}

/**
 * Holographic signs and ads: additive planes, so the art's black background is simply
 * transparent. Scan lines, a slow shimmer and a rare glitch sell the hologram; fog fades
 * them instead of tinting (additive fog would light up the whole rectangle). One draw call.
 */
function createHolograms(layout: Layout, holos: NonNullable<Layout['signs']>, art: SignArt, atlas: SignAtlas, time: { value: number }, lights: SignLight[]) {
  if (!holos.length) return null;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const n = holos.length;
  const rect = new Float32Array(n * 4);
  const params = new Float32Array(n * 4);
  const tint = new Float32Array(n * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
  material.name = 'holo-signs';
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.name = 'holo-signs';
  holos.forEach((s, i) => {
    const rng = mulberry32((s.seed ^ layout.seed) >>> 0);
    if (s.brand !== undefined) {
      // Stroke wordmark (source 0): tube color per brand, a steady glow (brands don't glitch).
      const brand = s.brand % BRANDS;
      const d = (s.stroke === 'blade' ? atlas.blades : atlas.panels).find((x) => x.brand === brand)!;
      d.rect.toArray(rect, i * 4);
      const c = col(BRAND_COLORS[brand]);
      c.toArray(tint, i * 3);
      params.set([0, rng(), 2.4, 0], i * 4);
      lights.push({ x: s.position[0], y: s.position[1], z: s.position[2], size: s.size[0], color: c, strength: 1 });
    } else {
      const e = ART_ENTRIES[s.art!];
      rect.set(e.rect, i * 4);
      const ad = e.kind === 'ad';
      const glitchy = rng() < 0.15 ? 1 : 0;
      tint.set([1, 1, 1], i * 3);
      // Tall holographic ads are neon-like and seen from far: brighter than posters.
      params.set([atlasCode(e), rng(), ad ? (e.aspect < 0.45 ? 3.0 : 1.3) : 2.9, glitchy], i * 4);
      lights.push({ x: s.position[0], y: s.position[1], z: s.position[2], size: Math.max(s.size[0], s.size[1]), color: new THREE.Color(...e.color), strength: ad ? 0.6 : 1 });
    }
    // Planes face +Z like the sign boxes; lift 0.1 m further off the wall (boxes are 0.2–0.35 deep).
    const pos = new THREE.Vector3(...s.position);
    if (s.kind === 'panel') pos.add(new THREE.Vector3(Math.sin(s.rotationY), 0, Math.cos(s.rotationY)).multiplyScalar(0.1));
    m.compose(pos, q.setFromAxisAngle(up, s.rotationY), new THREE.Vector3(s.size[0], s.size[1], 1));
    mesh.setMatrixAt(i, m);
  });
  geometry.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geometry.setAttribute('aHolo', new THREE.InstancedBufferAttribute(params, 4));
  geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uStroke = { value: atlas.texture };
    shader.uniforms.uNeonV = { value: art.atlases[0] };
    shader.uniforms.uNeonH = { value: art.atlases[1] };
    shader.uniforms.uPosterP = { value: art.atlases[2] };
    shader.uniforms.uPosterL = { value: art.atlases[3] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nattribute vec4 aHolo;\nattribute vec3 aTint;\nvarying vec2 vHoloUv;\nflat varying vec4 vHolo;\nflat varying vec3 vTint;\nflat varying vec4 vRect;\nvarying vec3 vPlaneW;\nflat varying vec3 vPlaneN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoloUv = aRect.xy + uv * aRect.zw;\nvHolo = aHolo;\nvTint = aTint;\nvRect = aRect;\nvPlaneW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;\nvPlaneN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * vec3(0.0, 0.0, 1.0));');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform sampler2D uStroke, uNeonV, uNeonH, uPosterP, uPosterL;
varying vec2 vHoloUv;
flat varying vec4 vHolo;
flat varying vec3 vTint;
flat varying vec4 vRect;
varying vec3 vPlaneW;
flat varying vec3 vPlaneN;`)
      .replace('#include <map_fragment>', `
int src = int(vHolo.x + 0.5);
float seed = vHolo.y * 100.0;
vec2 huv = vHoloUv;
// Double-sided plane: seen from behind, mirror u within the art's rect so text reads
// correctly from both sides (blades over the street are viewed from both directions).
// Decided geometrically: gl_FrontFacing is unreliable on some GL backends (SwiftShader).
if (dot(vPlaneN, cameraPosition - vPlaneW) < 0.0) huv.x = vRect.x + vRect.z - (huv.x - vRect.x);
// Rare glitch: a horizontal tear for a fraction of a second.
float tear = vHolo.w * step(0.985, fract(uTime * 0.37 + vHolo.y * 13.0)) * step(0.5, fract(huv.y * 23.0 + uTime * 5.0));
huv.x += tear * 0.015;
vec3 img;
if (src == 0) {
  // Stroke atlas (brand wordmarks): tube core from R plus a soft halo from a coarse mip.
  float core = texture2D(uStroke, huv).r;
  float halo = textureLod(uStroke, huv, 3.0).r;
  img = mix(vTint, vec3(1.0), 0.15) * core + vTint * halo * 0.6;
} else {
  img = src == 2 ? texture2D(uNeonV, huv).rgb : src == 3 ? texture2D(uNeonH, huv).rgb
      : src == 4 ? texture2D(uPosterP, huv).rgb : texture2D(uPosterL, huv).rgb;
  // Black level: the art's near-black background must add nothing.
  img = max(img - 0.035, 0.0) * 1.04;
}
float scan = 0.86 + 0.14 * sin(gl_FragCoord.y * 1.9 + uTime * 3.0);
float shimmer = 0.9 + 0.1 * sin(uTime * 1.7 + seed);
diffuseColor = vec4(img * vHolo.z * scan * shimmer, 1.0);`)
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
  gl_FragColor.rgb *= 1.0 - heightFog(vFogWorld, fogDensity);
#endif`);
  };
  material.customProgramCacheKey = () => 'holo-signs-v4';
  return mesh;
}

const metal = col('metal_dark');

/** Shared frames, blade arms and screen back rails, batched into one instanced draw. */
function createBrackets(signs: NonNullable<Layout['signs']>): THREE.InstancedMesh | null {
  const hardware: { sign: (typeof signs)[number]; center: number[]; scale: number[] }[] = [];
  for (const s of signs) {
    const [w, h, depth] = s.size;
    const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
      hardware.push({ sign: s, center: [x,y,z], scale: [sx,sy,sz] });
    // Holograms (transparent around the art) and brand lettering have no frame: a frame
    // sized to the sign box would float away from the visible glow.
    const holo = s.brand !== undefined || (s.art !== undefined && ART_ENTRIES[s.art].holo);
    const screen = s.art !== undefined && ART_ENTRIES[s.art].surface === 'screen';
    const t = Math.min(screen ? 0.18 : 0.09, w * 0.045);
    if (!holo) {
      add(0,h/2,0,w+t,t,depth+0.08); add(0,-h/2,0,w+t,t,depth+0.08);
      add(-w/2,0,0,t,h,depth+0.08); add(w/2,0,0,t,h,depth+0.08);
    }
    if (s.kind === 'blade') {
      // Hanger arm along the top from the far edge to the wall, and a bottom stub to the
      // wall. The wall is at local +x = w/2 + arm (layout: arm clears balconies/AC units).
      const arm = s.arm ?? 0.3, tb = 0.07;
      add((arm + 0.05) / 2, h/2 + tb, 0, w + arm - 0.05, tb, tb);
      add(w/2 + arm/2, -h/2 + 0.2, 0, arm, tb * 0.8, tb * 0.8);
      if (holo) add(-w/2 + 0.05, h/2 - 0.02, 0, tb, tb * 2, tb);   // hanger drop at the far end
    } else if (s.legs !== undefined) {
      // Rooftop board or crown lettering: posts and a brace down to the roof.
      if (!holo) add(0, 0, -depth / 2 - 0.06, w, h, 0.12);
      const legs = s.legs, n = w > 14 ? 4 : 2;
      for (let k = 0; k < n; k++) {
        const x = -w * 0.4 + (w * 0.8 * k) / (n - 1);
        add(x, -h / 2 - legs / 2, -depth / 2 - 0.2, 0.2, legs, 0.2);
      }
      add(0, -h / 2 - legs * 0.5, -depth / 2 - 0.2, w * 0.8, 0.1, 0.1);
      if (holo) add(0, -h / 2 - 0.05, -depth / 2 - 0.2, w * 0.9, 0.1, 0.15);   // mounting rail
    } else if (screen) {
      // Back rails give large mounted displays thickness when viewed obliquely.
      add(-w*0.3,0,-depth*0.6,t,h,t); add(w*0.3,0,-depth*0.6,t,h,t);
    }
  }
  if (!hardware.length) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: metal, roughness: 0.55, metalness: 0.5 }), hardware.length);
  mesh.name = 'sign-housings';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  hardware.forEach(({ sign: s, center, scale }, i) => {
    q.setFromAxisAngle(up, s.rotationY);
    p.fromArray(center).applyQuaternion(q).add(new THREE.Vector3(...s.position));
    m.compose(p, q, new THREE.Vector3().fromArray(scale));
    mesh.setMatrixAt(i, m);
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
attribute float aGain;
flat varying float vGain;
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
vParams = aParams;
vGain = aGain;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uSignGain;
flat varying float vGain;
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
  vec4 artwork = src == 2 ? texture2D(uNeonV, vSignUv) : src == 3 ? texture2D(uNeonH, vSignUv)
           : src == 4 ? texture2D(uPosterP, vSignUv) : texture2D(uPosterL, vSignUv);
  float fl = vParams.w > 0.0 ? step(0.3, fract(sin(floor(uTime * 9.0) * 91.7 + vParams.y * 1000.0) * 4375.85)) : 1.0;
  // Alpha is a separate emission mask, not opacity. The metal backing stays unlit.
  diffuseColor.rgb = artwork.rgb * 0.65;
  totalEmissiveRadiance += artwork.rgb * artwork.a * vGain * fl * uSignGain;
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
  material.customProgramCacheKey = () => 'signs-v4';
  return material;
}
