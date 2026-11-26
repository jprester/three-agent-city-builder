import * as THREE from 'three';
import palette from '../../../art/style/palette.json';
import { mulberry32 } from '../../../art/layouts/lib/rng.mjs';
import type { Layout } from '../../systems/layout';
import { ART_ENTRIES, type SignArt } from './art';

/** Emission multiplier for the big tower ads (zones shaft and billboard; human review 2026-09-28). */
const TOWER_AD_GAIN = 1.8;

export interface SignUniforms {
  uTime: { value: number };
  uSignGain: { value: number };
  uArt0: { value: THREE.Texture | null };
  uArt1: { value: THREE.Texture | null };
  uArt2: { value: THREE.Texture | null };
  uArt3: { value: THREE.Texture | null };
}

export function signUniforms(art: SignArt, time: { value: number }): SignUniforms {
  return {
    uTime: time, uSignGain: { value: 1 },
    uArt0: { value: art.atlases[0] }, uArt1: { value: art.atlases[1] },
    uArt2: { value: art.atlases[2] }, uArt3: { value: art.atlases[3] },
  };
}

const col = (name: string) => new THREE.Color(palette[name as keyof typeof palette]);

/** Where a sign throws light: position, size and its dominant color (for the sign light map). */
export interface SignLight {
  x: number;
  y: number;
  z: number;
  size: number;
  color: THREE.Color;
  strength: number;
}

type Sign = NonNullable<Layout['signs']>[number];
const isHolo = (s: Sign) => ART_ENTRIES[s.art]?.holo === true;

const ATLAS_GLSL = `
uniform sampler2D uArt0, uArt1, uArt2, uArt3;
vec4 signArt(int a, vec2 uv) {
  return a == 0 ? texture2D(uArt0, uv) : a == 1 ? texture2D(uArt1, uv) : a == 2 ? texture2D(uArt2, uv) : texture2D(uArt3, uv);
}`;

/**
 * Every sign is an image from the one library (tools/textures/build_signs.py). Lightboxes,
 * neon boards and campaigns are boxes: the ±Z faces show the image, the rest is a dark metal
 * case. Crown lettering (lit letters on black) is drawn additive with no board. Hardware
 * (case lips, blade arms, roof posts, floodlights) is one more instanced draw, lamp heads one.
 */
export function createSigns(layout: Layout, uniforms: SignUniforms): { mesh: THREE.InstancedMesh; holo: THREE.InstancedMesh | null; brackets: THREE.InstancedMesh | null; floods: THREE.InstancedMesh | null; lanterns: THREE.InstancedMesh | null; lights: SignLight[] } | null {
  const signs = (layout.signs ?? []).filter((s) => ART_ENTRIES[s.art] !== undefined);
  if (!signs.length) return null;
  const lights: SignLight[] = [];
  const boxes = signs.filter((s) => !isHolo(s) && s.kind !== 'lantern');
  const holos = signs.filter(isHolo);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const n = boxes.length;
  const rect = new Float32Array(n * 4);
  const params = new Float32Array(n * 4);
  const gains = new Float32Array(n);
  const mesh = new THREE.InstancedMesh(geometry, createSignMaterial(uniforms), n);
  mesh.name = 'signs';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);

  boxes.forEach((s, i) => {
    const rng = mulberry32((s.seed ^ layout.seed) >>> 0);
    const e = ART_ENTRIES[s.art];
    rect.set(e.rect, i * 4);
    const neon = e.script === 'zh';
    lights.push({
      x: s.position[0], y: s.position[1], z: s.position[2],
      size: Math.max(s.size[0], s.size[1]), color: new THREE.Color(...e.color),
      strength: neon ? 1 : e.brand ? 0.5 : 0.65,
    });
    // Big tower campaigns read from blocks away: brighter than shop signs.
    gains[i] = e.gain * (s.zone === 'shaft' || s.zone === 'billboard' ? TOWER_AD_GAIN : 1);
    // A failing tube: a few neon boards and the odd fluorescent lightbox flicker.
    const flicker = !e.brand && rng() < (neon ? 0.12 : 0.03) ? 1 : 0;
    params.set([e.atlas, rng(), 0, flicker], i * 4);
    m.compose(new THREE.Vector3(...s.position), q.setFromAxisAngle(up, s.rotationY), new THREE.Vector3(...s.size));
    mesh.setMatrixAt(i, m);
  });
  geometry.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  geometry.setAttribute('aGain', new THREE.InstancedBufferAttribute(gains, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  const holo = createLettering(holos, uniforms, lights);
  const lanterns = createLanterns(signs.filter((s) => s.kind === 'lantern'), lights);
  return { mesh, holo, brackets: createBrackets(signs), floods: createFloods(signs, lights), lanterns, lights };
}

/**
 * Crown lettering: additive planes, so the image's black is simply transparent. A steady
 * glow; fog fades it instead of tinting (additive fog would light up the whole rectangle).
 */
function createLettering(holos: Sign[], uniforms: SignUniforms, lights: SignLight[]) {
  if (!holos.length) return null;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const n = holos.length;
  const rect = new Float32Array(n * 4);
  const params = new Float32Array(n * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
  material.name = 'sign-lettering';
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.name = 'sign-lettering';
  holos.forEach((s, i) => {
    const e = ART_ENTRIES[s.art];
    rect.set(e.rect, i * 4);
    params.set([e.atlas, e.gain], i * 2);
    lights.push({ x: s.position[0], y: s.position[1], z: s.position[2], size: s.size[0], color: new THREE.Color(...e.color), strength: 1 });
    m.compose(new THREE.Vector3(...s.position), q.setFromAxisAngle(up, s.rotationY), new THREE.Vector3(s.size[0], s.size[1], 1));
    mesh.setMatrixAt(i, m);
  });
  geometry.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geometry.setAttribute('aHolo', new THREE.InstancedBufferAttribute(params, 2));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nattribute vec2 aHolo;\nvarying vec2 vHoloUv;\nflat varying vec2 vHolo;\nflat varying vec4 vRect;\nvarying vec3 vPlaneW;\nflat varying vec3 vPlaneN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoloUv = aRect.xy + uv * aRect.zw;\nvHolo = aHolo;\nvRect = aRect;\nvPlaneW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;\nvPlaneN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * vec3(0.0, 0.0, 1.0));');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSignGain;
${ATLAS_GLSL}
varying vec2 vHoloUv;
flat varying vec2 vHolo;
flat varying vec4 vRect;
varying vec3 vPlaneW;
flat varying vec3 vPlaneN;`)
      .replace('#include <map_fragment>', `
vec2 huv = vHoloUv;
// Double-sided plane: seen from behind, mirror u within the rect so the lettering reads from
// both sides. Decided geometrically: gl_FrontFacing is unreliable on some GL backends.
if (dot(vPlaneN, cameraPosition - vPlaneW) < 0.0) huv.x = vRect.x + vRect.z - (huv.x - vRect.x);
vec3 img = signArt(int(vHolo.x + 0.5), huv).rgb;
// Black level: the image's near-black background must add nothing.
img = max(img - 0.035, 0.0) * 1.04;
diffuseColor = vec4(img * vHolo.y * uSignGain, 1.0);`)
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
  gl_FragColor.rgb *= 1.0 - heightFog(vFogWorld, fogDensity);
#endif`);
  };
  material.customProgramCacheKey = () => 'sign-lettering-v1';
  return mesh;
}

const metal = col('metal_dark');

/** Floodlight arms on rooftop boards: n lamps along the top edge, reaching forward. */
function floodXs(w: number): number[] {
  const n = Math.max(3, Math.round(w / 3.5));
  return Array.from({ length: n }, (_, k) => -w / 2 + (w * (k + 0.5)) / n);
}

/** Case lips, blade arms, roof posts and floodlight arms, batched into one instanced draw. */
function createBrackets(signs: Sign[]): THREE.InstancedMesh | null {
  const hardware: Part[] = [];
  for (const s of signs) {
    const [w, h, depth] = s.size;
    const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rot?: [number, number]) =>
      hardware.push({ sign: s, center: [x, y, z], scale: [sx, sy, sz], rot });
    /** A member from a to b (local y, z or x, y), as a box of section t rotated into place. */
    const strut = (a: number[], b: number[], t: number) => {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(...d);
      // Rotation about local x (pitch, y→z) then z (roll, y→x): the box's long axis is y.
      const rx = Math.atan2(d[2], Math.hypot(d[0], d[1]));
      const rz = -Math.atan2(d[0], d[1]);
      add((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, t, len, t, [rx, rz]);
    };
    // Lettering has no frame: a frame sized to the sign box would float away from the glow.
    if (s.kind === 'lantern') {
      // Lacquer caps top and bottom, and the cord up to the canopy.
      const r = lanternR(s);
      for (const x of lanternXs(s)) {
        add(x, h * 0.36, 0, r * 1.1, 0.06, r * 1.1);
        add(x, -h * 0.46, 0, r * 1.1, 0.06, r * 1.1);
        add(x, h * 0.48, 0, 0.015, 0.2, 0.015);
      }
      continue;
    }
    const holo = isHolo(s);
    const t = Math.min(0.09, w * 0.045);
    if (!holo) {
      // The case lip wraps around the outside of the board.
      add(0, h / 2 + t / 2, 0, w + 2 * t, t, depth + 0.02);
      add(0, -h / 2 - t / 2, 0, w + 2 * t, t, depth + 0.02);
      add(-w / 2 - t / 2, 0, 0, t, h + 2 * t, depth + 0.02);
      add(w / 2 + t / 2, 0, 0, t, h + 2 * t, depth + 0.02);
    }
    if (s.kind === 'blade') {
      // Two arms from the far edge of the board to the wall, plus a plate on the wall.
      const arm = s.arm ?? 0.3;
      const tb = Math.max(0.08, Math.min(0.16, w * 0.05));
      add(arm / 2, h / 2 + t + tb / 2, 0, w + arm, tb, tb);
      add(arm / 2, -h / 2 - t - tb / 2, 0, w + arm, tb * 0.9, tb * 0.9);
      add(w / 2 + arm + 0.05, 0, 0, 0.1, Math.min(h * 0.9, 6), depth + 0.1);
      // Tenant column: rails at both ends run the full floor height, so the stacked panels
      // read as one steel column.
      if (s.column && s.span) for (const x of [-w / 2 - t - 0.05, w / 2 + t + 0.05]) add(x, 0, 0, 0.1, s.span + 0.02, 0.12);
    } else if (s.kind === 'stand') {
      // Standing sign: a weighted foot plate and two short feet.
      add(0, -h / 2 - 0.08, 0, w + 0.12, 0.05, 0.5);
      for (const x of [-w / 2 + 0.04, w / 2 - 0.04]) add(x, -h / 2 - 0.04, 0, 0.05, 0.1, 0.2);
    } else if (s.roof && s.legs !== undefined) {
      // Rooftop board on an exposed steel lattice (Shinjuku): columns behind the board down to
      // the roof, girts, X-bracing in every bay, raking struts back to the roof, a catwalk.
      add(0, 0, -depth / 2 - 0.06, w, h, 0.12);
      const legs = s.legs, zb = -depth / 2 - 0.2, yr = -h / 2 - legs;
      const m = Math.max(2, Math.round(w / 2.6));
      const xs = Array.from({ length: m + 1 }, (_, k) => -w / 2 + 0.1 + ((w - 0.2) * k) / m);
      for (const x of xs) add(x, (yr + h / 2) / 2, zb, 0.14, h + legs, 0.14);
      for (const y of [yr + 0.05, -h / 2, 0, h / 2 - 0.05]) add(0, y, zb - 0.02, w, 0.1, 0.1);
      for (let k = 0; k < m; k++) {
        const [x0, x1] = [xs[k], xs[k + 1]];
        for (const [y0, y1] of [[yr, -h / 2], [-h / 2, 0], [0, h / 2]]) {
          strut([x0, y0, zb - 0.05], [x1, y1, zb - 0.05], 0.06);
          strut([x1, y0, zb - 0.05], [x0, y1, zb - 0.05], 0.06);
        }
      }
      const back = (h + legs) * 0.42;
      for (let k = 0; k <= m; k += 2) {
        strut([xs[k], h * 0.2, zb - 0.1], [xs[k], yr, zb - back], 0.12);
        add(xs[k], yr + 0.05, zb - back / 2, 0.1, 0.1, back);
      }
      // Catwalk along the bottom edge for the poster crew, with a low rail.
      add(0, -h / 2 - 0.12, depth / 2 + 0.4, w, 0.05, 0.8);
      add(0, -h / 2 + 0.75, depth / 2 + 0.78, w, 0.04, 0.04);
      for (let x = -w / 2; x <= w / 2 + 0.01; x += w / Math.max(2, Math.round(w / 2))) add(x, -h / 2 + 0.31, depth / 2 + 0.78, 0.04, 0.86, 0.04);
    } else if (s.legs !== undefined) {
      // Crown lettering: posts and a brace down to the roof.
      if (!holo) add(0, 0, -depth / 2 - 0.06, w, h, 0.12);
      const legs = s.legs, n = w > 14 ? 4 : 2;
      for (let k = 0; k < n; k++) {
        const x = -w * 0.4 + (w * 0.8 * k) / (n - 1);
        add(x, -h / 2 - legs / 2, -depth / 2 - 0.2, 0.2, legs, 0.2);
      }
      add(0, -h / 2 - legs * 0.5, -depth / 2 - 0.2, w * 0.8, 0.1, 0.1);
      if (holo) add(0, -h / 2 - 0.05, -depth / 2 - 0.2, w * 0.9, 0.1, 0.15);   // mounting rail
    }
    if (s.flood) for (const x of floodXs(w)) add(x, h / 2 + 0.25, depth / 2 + 0.6, 0.07, 0.07, 1.2);
  }
  if (!hardware.length) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: metal, roughness: 0.55, metalness: 0.5 }), hardware.length);
  mesh.name = 'sign-housings';
  place(mesh, hardware);
  return mesh;
}

/** Floodlight heads on rooftop boards: small lit boxes at the end of each arm, aimed back. */
function createFloods(signs: Sign[], lights: SignLight[]): THREE.InstancedMesh | null {
  const heads: Part[] = [];
  for (const s of signs) {
    if (!s.flood) continue;
    const [w, h, depth] = s.size;
    for (const x of floodXs(w)) heads.push({ sign: s, center: [x, h / 2 + 0.3, depth / 2 + 1.2], scale: [0.4, 0.2, 0.25] });
    lights.push({ x: s.position[0], y: s.position[1] + h / 2, z: s.position[2], size: w, color: col('tungsten'), strength: 0.4 });
  }
  if (!heads.length) return null;
  const material = new THREE.MeshBasicMaterial({ color: col('tungsten').multiplyScalar(2.5) });
  material.name = 'sign-floodlights';
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, heads.length);
  mesh.name = 'sign-floodlights';
  place(mesh, heads);
  return mesh;
}

type Part = { sign: Sign; center: number[]; scale: number[]; rot?: [number, number] };

/**
 * Paper lanterns (chōchin) in rows along shop canopies: a lit body (a low-poly sphere stretched
 * upright, one MeshBasic draw like the floodlight heads, so no new shader program). Their lacquer
 * caps and cords are boxes in the hardware draw (createBrackets).
 */
function createLanterns(rows: Sign[], lights: SignLight[]): THREE.InstancedMesh | null {
  if (!rows.length) return null;
  const bodies: Part[] = [];
  // Lit paper reads brighter than its pigment (x1.25; more washes it out to salmon in the grade).
  const red = col('lantern_red').multiplyScalar(1.25);
  for (const s of rows) {
    const [w, h] = s.size;
    for (const x of lanternXs(s)) bodies.push({ sign: s, center: [x, -0.05, 0], scale: [lanternR(s) * 2, h * 0.78, lanternR(s) * 2] });
    lights.push({ x: s.position[0], y: s.position[1], z: s.position[2], size: w + 1, color: col('lantern_red'), strength: 0.35 });
  }
  const material = new THREE.MeshBasicMaterial({ color: red });
  material.name = 'sign-lanterns';
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), material, bodies.length);
  mesh.name = 'sign-lanterns';
  place(mesh, bodies);
  return mesh;
}

const lanternR = (s: Sign) => Math.min(0.19, s.size[0] / (s.count ?? 2) / 2.4);
const lanternXs = (s: Sign) => Array.from({ length: s.count ?? 2 }, (_, k) => -s.size[0] / 2 + (s.size[0] * (k + 0.5)) / (s.count ?? 2));

function place(mesh: THREE.InstancedMesh, parts: Part[]) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3(), local = new THREE.Quaternion(), e = new THREE.Euler();
  parts.forEach(({ sign: s, center, scale, rot }, i) => {
    q.setFromAxisAngle(up, s.rotationY);
    p.fromArray(center).applyQuaternion(q).add(new THREE.Vector3(...s.position));
    if (rot) q.multiply(local.setFromEuler(e.set(rot[0], 0, rot[1], 'ZXY')));
    m.compose(p, q, new THREE.Vector3().fromArray(scale));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function createSignMaterial(uniforms: SignUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: metal, roughness: 0.5, metalness: 0.4 });
  material.name = 'signs';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aRect;
attribute vec4 aParams;
attribute float aGain;
flat varying float vGain;
varying vec2 vSignUv;
varying float vFace;
flat varying vec4 vParams;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFace = abs(normal.z) > 0.5 ? 1.0 : 0.0;
vSignUv = aRect.xy + uv * aRect.zw;
vParams = aParams;
vGain = aGain;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uSignGain;
${ATLAS_GLSL}
flat varying float vGain;
varying vec2 vSignUv;
varying float vFace;
flat varying vec4 vParams;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vFace > 0.5) {
  vec4 artwork = signArt(int(vParams.x + 0.5), vSignUv);
  // A failing tube: the whole sign stutters now and then, on the shared clock.
  float fl = vParams.w > 0.0 ? step(0.3, fract(sin(floor(uTime * 9.0) * 91.7 + vParams.y * 1000.0) * 4375.85))
    + step(0.12, fract(uTime * 0.11 + vParams.y * 7.0)) : 1.0;
  fl = min(fl, 1.0);
  // Alpha is the emission mask, not opacity; the black around a sign is its dark case.
  diffuseColor.rgb = artwork.rgb * 0.65;
  totalEmissiveRadiance += artwork.rgb * artwork.a * vGain * fl * uSignGain;
}`);
  };
  material.customProgramCacheKey = () => 'signs-v5';
  return material;
}
