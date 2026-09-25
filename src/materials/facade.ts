import * as THREE from 'three';
import facade from '../../art/style/facade.json';
import palette from '../../art/style/palette.json';
import { TOWER_BUNDLES, type FacadeTextures } from './textures';

/**
 * The one material for every facade-shaded asset (buildings, and props built from the same
 * surface types). Geometry carries only what protrudes; windows, storefronts, lit canopies
 * and fixtures are shaded here from two vertex channels written by the Blender generators
 * (art/generators/lib/surface.py):
 *   COLOR_0     r: surface type, g: fill (share of cells with a window), b: tint
 *   TEXCOORD_0  facade coordinates in meters (u along, v up; glTF-flipped v)
 * Three sources of detail:
 *   - "atlas" faces (tower shafts, office bodies) map photographic facades from the tower
 *     bundles at real scale (art/external/textures, tools/textures/import_highrise.py);
 *   - residential/office windows are interior-mapped rooms with frames, sills and recesses;
 *   - walls sample image materials (tile, concrete, panels, metal) with luminance relief.
 *
 * Extends MeshStandardMaterial via onBeforeCompile so lighting, fog and tone mapping apply.
 */
export interface FacadeUniforms {
  uTime: { value: number };
  /** Layout seed: all window randomness derives from it plus the instance position. */
  uSeed: { value: number };
  /** Top-down street-light intensity (see src/scene/lampmap.ts). */
  uLampMap: { value: THREE.Texture | null };
  /** minX, minZ, 1/sizeX, 1/sizeZ of the lamp map in world meters. */
  uLampRect: { value: THREE.Vector4 };
  /** Overall window emission multiplier (debug tuning). */
  uWindowGain: { value: number };
  uTowerDiff0: { value: THREE.Texture | null };
  uTowerDiff1: { value: THREE.Texture | null };
  uTowerDiff2: { value: THREE.Texture | null };
  uTowerEmit0: { value: THREE.Texture | null };
  uTowerEmit1: { value: THREE.Texture | null };
  uTowerEmit2: { value: THREE.Texture | null };
  uTowerNorm0: { value: THREE.Texture | null };
  uTowerNorm1: { value: THREE.Texture | null };
  uTowerNorm2: { value: THREE.Texture | null };
  uWalls: { value: THREE.Texture | null };
  /** Top-down colored sign glow (same rect as the lamp map). */
  uSignMap: { value: THREE.Texture | null };
}

const c = (name: keyof typeof palette) => new THREE.Color(palette[name]);
const glslColor = (name: keyof typeof palette) => {
  const col = c(name); // THREE.Color is linear once parsed from sRGB hex
  return `vec3(${col.r.toFixed(5)}, ${col.g.toFixed(5)}, ${col.b.toFixed(5)})`;
};
const f = (v: number) => v.toFixed(6);
const T = facade.types;
const C = facade.cells;

// Tower facade table: rect (u0, v0, u1, v1 in image space, y down) and
// (floor height, bay width, wrap width, wrap height) in atlas UV units.
const towerFacades = TOWER_BUNDLES.flatMap((b) => b.facades);
const TF_COUNT = towerFacades.length;
const TF_RECT = towerFacades.map((t) => `vec4(${t.rect.map(f).join(', ')})`).join(',\n  ');
const TF_DIM = towerFacades.map((t) => `vec4(${f(t.floor)}, ${f(t.bay)}, ${f(t.wrap[0])}, ${f(t.wrap[1])})`).join(',\n  ');

const DEFINES = /* glsl */ `
#define T_RES ${T.residential}
#define T_OFFICE ${T.office}
#define T_CURTAIN ${T.curtain}
#define T_PODIUM ${T.podium}
#define T_ROOF ${T.roof}
#define T_TRIM ${T.trim}
#define T_METAL ${T.metal}
#define T_CAGE ${T.cage}
#define T_SOFFIT ${T.soffit}
#define T_FIXTURE ${T.fixture}
#define T_ATLAS ${T.atlas}
#define T_SCREEN ${T.screen}
const vec2 CELL_RES = vec2(${f(C.residential.w)}, ${f(C.residential.h)});
const vec2 CELL_OFFICE = vec2(${f(C.office.w)}, ${f(C.office.h)});
const vec2 CELL_CURTAIN = vec2(${f(C.curtain.w)}, ${f(C.curtain.h)});
const vec2 CELL_PODIUM = vec2(${f(C.podium.w)}, ${f(C.podium.h)});
const vec3 P_CONCRETE = ${glslColor('concrete')};
const vec3 P_CONCRETE_DARK = ${glslColor('concrete_dark')};
const vec3 P_TILE = ${glslColor('tile_stained')};
const vec3 P_METAL = ${glslColor('metal_dark')};
const vec3 P_GLASS = ${glslColor('glass_dark')};
const vec3 P_TUNGSTEN = ${glslColor('tungsten')};
const vec3 P_FLUORESCENT = ${glslColor('fluorescent')};
const vec3 P_TV = ${glslColor('tv_blue')};
const vec3 P_SODIUM = ${glslColor('sodium')};
const vec3 P_RED = ${glslColor('sign_red')};
const vec3 P_HAZE = ${glslColor('haze')};
const vec3 P_SKY = ${glslColor('sky')};
const vec3 P_CYAN = ${glslColor('sign_cyan')};
const vec3 P_AMBER = ${glslColor('sign_amber')};
const vec3 P_PAINT[4] = vec3[4](${glslColor('paint_mint')}, ${glslColor('paint_salmon')}, ${glslColor('paint_cream')}, ${glslColor('paint_blue')});
const vec4 TF_RECT[${TF_COUNT}] = vec4[${TF_COUNT}](
  ${TF_RECT});
const vec4 TF_DIM[${TF_COUNT}] = vec4[${TF_COUNT}](
  ${TF_DIM});
`;

const VERTEX_PARS = /* glsl */ `
uniform float uSeed;
varying vec2 vFacadeUv;
varying vec3 vSurf;
varying float vInstSeed;
varying vec3 vFWorld;
varying vec3 vFNormal;
varying vec2 vRawUv;
`;

// After batching_vertex: the instance matrix is known; derive scale compensation and seed.
const VERTEX_INSTANCE = /* glsl */ `
#include <batching_vertex>
mat4 fInst = mat4(1.0);
#ifdef USE_BATCHING
  fInst = batchingMatrix;
#endif
#ifdef USE_INSTANCING
  fInst = instanceMatrix;
#endif
vec3 fScale = vec3(length(fInst[0].xyz), length(fInst[1].xyz), length(fInst[2].xyz));
// u runs along local x on faces facing ±z, along local z on faces facing ±x; v runs up
// (horizontal faces use the other horizontal axis).
bool fAlongX = abs(normal.z) >= abs(normal.x);
float fSu = fAlongX ? fScale.x : fScale.z;
float fSv = abs(normal.y) > 0.7 ? (fAlongX ? fScale.z : fScale.x) : fScale.y;
vFacadeUv = vec2(uv.x * fSu, (1.0 - uv.y) * fSv);   // glTF stores 1 - v
vSurf = color.rgb;
vRawUv = vec2(uv.x, 1.0 - uv.y);
vInstSeed = fract(sin(dot(fInst[3].xz, vec2(12.9898, 78.233)) + uSeed * 0.0137) * 43758.5453);
vFNormal = normalize(mat3(fInst) * normal);
`;

const VERTEX_WORLD = /* glsl */ `
#include <project_vertex>
vFWorld = (fInst * vec4(transformed, 1.0)).xyz;
vFWorld = (modelMatrix * vec4(vFWorld, 1.0)).xyz;
vFNormal = normalize(mat3(modelMatrix) * vFNormal);
`;

const FRAGMENT_PARS = /* glsl */ `
${DEFINES}
uniform float uTime;
uniform sampler2D uLampMap;
uniform vec4 uLampRect;
uniform float uWindowGain;
uniform sampler2D uTowerDiff0, uTowerDiff1, uTowerDiff2;
uniform sampler2D uTowerEmit0, uTowerEmit1, uTowerEmit2;
uniform sampler2D uTowerNorm0, uTowerNorm1, uTowerNorm2;
uniform sampler2D uWalls;
uniform sampler2D uSignMap;
varying vec2 vFacadeUv;
varying vec3 vSurf;
varying float vInstSeed;
varying vec3 vFWorld;
varying vec3 vFNormal;
varying vec2 vRawUv;

// World-space shading normal chosen by the surface code, applied in normal_fragment_maps.
vec3 fNormalW;

float fHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y);
}
// Anti-aliased 1D box [a, b] with filter width w.
float fBox(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
}
// The night sky as a reflection: glow at the horizon, dark overhead.
vec3 skyRefl(vec3 r) {
  float y = max(r.y, 0.0);
  return mix(P_HAZE * 1.6 + P_SODIUM * 0.03, P_SKY, smoothstep(0.0, 0.5, y));
}

void towerSample(int bundle, vec2 uv, vec2 dx, vec2 dy, out vec4 dr, out vec3 em, out vec3 nm) {
  if (bundle == 0) {
    dr = textureGrad(uTowerDiff0, uv, dx, dy); em = textureGrad(uTowerEmit0, uv, dx, dy).rgb; nm = textureGrad(uTowerNorm0, uv, dx, dy).rgb;
  } else if (bundle == 1) {
    dr = textureGrad(uTowerDiff1, uv, dx, dy); em = textureGrad(uTowerEmit1, uv, dx, dy).rgb; nm = textureGrad(uTowerNorm1, uv, dx, dy).rgb;
  } else {
    dr = textureGrad(uTowerDiff2, uv, dx, dy); em = textureGrad(uTowerEmit2, uv, dx, dy).rgb; nm = textureGrad(uTowerNorm2, uv, dx, dy).rgb;
  }
}

// Wall material cell m (4×2 atlas) at facade meters uvm, one tile per 'size' meters,
// mirror-repeated so the tiles need not be seamless. Returns diffuse+roughness and a
// luminance gradient for relief.
vec4 wallSample(int m, vec2 uvm, float size, out vec2 grad) {
  vec2 cell = vec2(float(m - (m / 4) * 4) * 0.25, 1.0 - float(m / 4 + 1) * 0.5);
  vec2 l = uvm / size;
  vec2 t = abs(fract(l * 0.5) * 2.0 - 1.0);
  vec2 k = vec2(0.25, 0.5) * 0.99;
  vec2 uv = cell + vec2(0.00125, 0.0025) + t * k;
  vec2 dx = dFdx(l) * k, dy = dFdy(l) * k;
  vec4 s = textureGrad(uWalls, uv, dx, dy);
  vec2 e = vec2(1.5 / 2048.0, 0.0);
  float lx = dot(textureGrad(uWalls, uv + e.xy, dx, dy).rgb, vec3(0.333));
  float ly = dot(textureGrad(uWalls, uv + e.yx * 2.0, dx, dy).rgb, vec3(0.333));
  float l0 = dot(s.rgb, vec3(0.333));
  // Relief fades out once a texel is smaller than a pixel.
  grad = vec2(lx - l0, ly - l0) * (1.0 - smoothstep(0.3, 1.5, length(dx) * 2048.0));
  return s;
}

// Interior mapping: the room behind a window, seen through point wp (meters from the
// window's lower-left) along the tangent-space view vector vt (x right, y up, z out).
vec3 room(vec2 wp, vec2 wsize, vec3 vt, vec3 col, float h) {
  vec3 size = vec3(wsize.x + 1.4, 2.8, 3.0 + 2.5 * h);
  vec3 o = vec3(wp.x + 0.7, wp.y + 0.85, 0.0);
  vec3 d = normalize(vec3(-vt.x, -vt.y, max(vt.z, 0.08)));
  vec3 tm = (step(0.0, d) * size - o) / d;
  float t = min(min(tm.x, tm.y), tm.z);
  vec3 p = o + d * t;
  float c;
  // Painted room walls in a few household tints.
  vec3 paint = mix(vec3(1.0, 0.92, 0.8), mix(vec3(0.75, 0.85, 0.8), vec3(0.95, 0.75, 0.7), fract(h * 13.0)), step(0.5, fract(h * 29.0)));
  if (t == tm.z) {
    // Back wall with a furniture band (shelves, a sofa back) and a picture or TV.
    c = 0.45 + 0.15 * h;
    float band = fBox(p.y, 0.0, 0.9 + 0.5 * fract(h * 7.0), 0.02) * fBox(p.x, size.x * fract(h * 3.0) * 0.5, size.x * (0.5 + 0.5 * fract(h * 5.0)), 0.02);
    c = mix(c, 0.1, band);
    c = mix(c, 0.22, fBox(p.y, 1.4, 1.9, 0.02) * fBox(p.x, 0.6, 1.3, 0.02) * step(0.5, fract(h * 11.0)));
  } else if (t == tm.y) {
    c = d.y > 0.0 ? 0.6 : 0.18;    // ceiling / floor
    paint = d.y > 0.0 ? vec3(1.0) : vec3(0.8, 0.6, 0.45);
  } else {
    c = 0.32;                      // side walls
    // A wardrobe or shelf against one side wall.
    c = mix(c, 0.12, fBox(p.z, 0.5, 1.6, 0.02) * fBox(p.y, 0.0, 2.0, 0.02) * step(0.4, fract(h * 17.0)));
  }
  // Ceiling lamp in the middle of the room.
  vec3 lamp = vec3(size.x * 0.5, size.y - 0.1, size.z * 0.5);
  float light = 0.3 + 0.85 * exp(-dot(p - lamp, p - lamp) / 3.0);
  return col * paint * c * light;
}

// Window layer for residential / office / curtain facades (cage reuses residential).
void windowLayer(int type, vec2 uvm, vec2 fw, float fill, float seed, vec3 vt, out vec3 emit, out float mask, out float frame,
                 out vec3 cellEmit, out vec3 rowEmit, out vec3 avgEmit, out float windowFrac, out float around,
                 out vec3 spill, out vec3 avgSpill) {
  vec2 cell = type == T_OFFICE ? CELL_OFFICE : type == T_CURTAIN ? CELL_CURTAIN : CELL_RES;
  vec2 cid = floor(uvm / cell);
  vec2 p = uvm - cid * cell;           // meters inside the cell
  vec4 r; // window rect x0, x1, y0, y1
  if (type == T_OFFICE) r = vec4(0.08, cell.x - 0.08, 0.95, 2.95);
  else if (type == T_CURTAIN) r = vec4(0.05, cell.x - 0.05, 0.12, cell.y - 0.28);
  else r = vec4(0.8, 2.4, 0.9, 2.45);
  windowFrac = (r.y - r.x) * (r.w - r.z) / (cell.x * cell.y);

  float s = seed * 97.13;
  float hWin = fHash(cid + s);
  float present = step(hWin, fill);
  float litRatio = mix(0.25, 0.55, fract(seed * 7.31));
  float baseRatio = litRatio;
  if (type == T_OFFICE || type == T_CURTAIN) {
    litRatio *= type == T_CURTAIN ? 0.3 : 0.5;
    baseRatio = litRatio;
    float floorOn = fHash(vec2(cid.y, floor(cid.x / 7.0) + s + 3.1));
    litRatio *= floorOn < 0.45 ? 0.0 : floorOn > 0.9 ? 3.0 : 1.0;
  }
  float hLit = fHash(cid + s + 17.7);
  float lit = step(hLit, litRatio) * present;
  float hTemp = fHash(cid + s + 5.3);
  float hMod = fHash(cid + s + 9.1);
  // Mostly warm tungsten; fluorescent and TV-blue as the minority.
  vec3 col = hTemp < 0.62 ? P_TUNGSTEN : hTemp < 0.8 ? mix(P_TUNGSTEN, P_SODIUM, 0.55) : hTemp < 0.94 ? P_FLUORESCENT : P_TV;
  float inten = mix(0.9, 2.2, fHash(cid + s + 2.9));
  if (hTemp >= 0.93) {
    float t = uTime * (5.0 + 9.0 * hMod) + hMod * 40.0;
    inten *= 0.35 + 0.65 * fNoise(vec2(t, hMod * 13.0));
  }

  vec2 q = (p - r.xz) / (r.yw - r.xz);   // 0..1 across the window
  vec2 wsize = r.yw - r.xz;
  vec3 inside = room(p - r.xz, wsize, vt, col, fHash(cid + s + 21.0)) * inten;
  // Blinds (slats), curtains (fabric glowing through), or clear.
  if (hMod < 0.3) {
    float slat = 0.3 + 0.7 * smoothstep(0.3, 0.7, fract(q.y * 12.0));
    slat = mix(slat, 0.65, smoothstep(0.015, 0.05, fw.y));   // slats ~13 cm: average before they alias
    float drawn = step(q.y, mix(0.35, 1.0, fract(hMod * 3.3)));
    inside = mix(inside, col * inten * 0.55 * slat, drawn);
  } else if (hMod < 0.55) {
    vec3 cloth = mix(vec3(0.9, 0.75, 0.55), vec3(0.8, 0.35, 0.3), fract(hMod * 17.0));
    float cover = fBox(q.x, hMod > 0.42 ? -0.1 : 0.5, hMod > 0.42 ? 0.5 : 1.1, 0.02);
    float folds = mix(0.75 + 0.25 * sin(q.x * 40.0), 0.75, smoothstep(0.02, 0.06, fw.x));
    inside = mix(inside, col * cloth * inten * 0.5 * folds, cover);
  }

  // Frame: border, a mullion and a transom (residential and office).
  float fwm = 0.05;
  float inner = fBox(p.x, r.x + fwm, r.y - fwm, fw.x) * fBox(p.y, r.z + fwm, r.w - fwm, fw.y);
  float bars = type == T_CURTAIN ? 0.0 : max(fBox(q.x, 0.49, 0.51, fw.x / wsize.x), fBox(q.y, 0.64, 0.665, fw.y / wsize.y));
  mask = fBox(p.x, r.x, r.y, fw.x) * fBox(p.y, r.z, r.w, fw.y) * present;
  frame = mask * (1.0 - inner * (1.0 - bars));
  // Recess shadow just around the opening.
  around = present * max(fBox(p.x, r.x - 0.14, r.y + 0.14, fw.x) * fBox(p.y, r.z - 0.1, r.w + 0.12, fw.y) - mask, 0.0);

  // Light from a lit window falls on the wall around it: falloff from the opening's edge.
  vec2 wc = (r.xz + r.yw) * 0.5, wh = (r.yw - r.xz) * 0.5;
  float wd = length(max(abs(p - wc) - wh, 0.0));
  spill = lit * col * inten * 0.55 * exp(-wd / 0.22) * (1.0 - mask) * (0.6 + 0.4 * step(p.y, wc.y));
  avgSpill = fill * min(litRatio, 1.0) * mix(P_TUNGSTEN, P_SODIUM, 0.2) * 1.45 * 0.06;

  // Unlit glass reflects the sky glow; lit glass shows the room.
  vec3 rv = reflect(-vt, vec3(0.0, 0.0, 1.0));
  vec3 refl = skyRefl(vec3(rv.x, rv.y, rv.z)) * (0.04 + 0.5 * pow(1.0 - max(vt.z, 0.0), 4.0));
  vec3 dark = P_HAZE * 0.05 + refl;
  emit = (mask - frame) * (lit > 0.5 ? inside + refl * 0.5 : dark);
  cellEmit = present * windowFrac * (lit > 0.5 ? col * inten * 0.6 : dark);
  vec3 meanLit = mix(P_TUNGSTEN, P_SODIUM, 0.2) * 1.2;
  rowEmit = fill * windowFrac * (min(litRatio, 1.0) * meanLit + (1.0 - min(litRatio, 1.0)) * dark);
  avgEmit = fill * windowFrac * (baseRatio * (type == T_RES ? 1.0 : 0.85) * meanLit + (1.0 - baseRatio) * dark);
}
`;

// Replaces color_fragment (vertex colors are data, not albedo).
const FRAGMENT_SURFACE = /* glsl */ `
int fType = int(vSurf.r * 16.0);
float fFill = vSurf.g;
float fTint = vSurf.b;
vec2 fUv = vFacadeUv;
vec2 fFw = max(fwidth(fUv), vec2(1e-4));
float fSeed = vInstSeed;
fNormalW = normalize(vFNormal);
vec3 fUp = vec3(0.0, 1.0, 0.0);
vec3 fT = abs(fNormalW.y) < 0.9 ? normalize(cross(fUp, fNormalW)) : vec3(1.0, 0.0, 0.0);
vec3 fB = normalize(cross(fNormalW, fT));
vec3 fV = normalize(cameraPosition - vFWorld);
vec3 fVt = vec3(dot(fV, fT), dot(fV, fB), dot(fV, fNormalW));

// Wall material per building: residential walls lean to mosaic tile and stained concrete,
// office walls to panels, slate and metal.
float fPick = fract(fSeed * 23.71);
int fMat = fType == T_OFFICE ? (fPick < 0.3 ? 7 : fPick < 0.55 ? 5 : fPick < 0.75 ? 6 : 1)
         : fType == T_ROOF ? (fPick < 0.5 ? 3 : 4)
         : (fPick < 0.38 ? 0 : fPick < 0.58 ? 1 : fPick < 0.74 ? 4 : fPick < 0.88 ? 3 : 5);
float fMatSize = fMat == 0 ? 2.4 : fMat == 5 ? 3.2 : (fMat == 2 || fMat == 6) ? 2.0 : 3.0;
vec2 fGrad;
vec4 fWall = wallSample(fMat, fUv + vec2(fSeed * 37.0, 0.0), fMatSize, fGrad);
// Per-building tint (faded paint / dirty tile), then grime streaks running down from
// sills and AC units, darker near the ground.
vec3 fTintCol = vec3(1.0 + 0.1 * (fract(fSeed * 5.3) - 0.5), 1.0, 1.0 - 0.12 * (fract(fSeed * 5.3) - 0.5));
// Photographic albedo is daylight-bright; walls at 2 a.m. only show where light reaches them.
vec3 fBase = fWall.rgb * fTintCol * mix(0.3, 0.6, fTint) * (0.75 + 0.35 * fract(fSeed * 13.7));
float fStreak = fNoise(vec2(fUv.x * 2.1 + fSeed * 50.0, fUv.y * 0.04)) * fNoise(vec2(fUv.x * 0.7, fUv.y * 0.3 + fSeed * 9.0));
float fGrime = 1.0 - 0.55 * smoothstep(0.15, 0.6, fStreak) - 0.2 * (1.0 - smoothstep(0.0, 12.0, vFWorld.y));
// Old residential slabs: a third get faded paint over the tile/concrete.
if ((fType == T_RES || fType == T_CAGE || fType == T_TRIM) && fract(fSeed * 41.3) < 0.45) {
  vec3 pc = P_PAINT[int(fract(fSeed * 17.9) * 4.0)];
  fBase = mix(fBase, pc * mix(0.45, 0.75, fTint) * dot(fWall.rgb, vec3(0.5)) * 2.0, 0.8);
}
// Rhythm between the windows: floor slab bands and faint pilasters at each bay.
if (fType == T_RES || fType == T_OFFICE) {
  vec2 cs = fType == T_OFFICE ? CELL_OFFICE : CELL_RES;
  float band = fBox(fract(fUv.y / cs.y) * cs.y, 0.0, 0.28, fFw.y);
  float pil = fBox(fract(fUv.x / cs.x + 0.5 / cs.x) * cs.x, 0.0, 0.18, fFw.x) * step(0.5, fract(fSeed * 9.7));
  fBase *= 1.0 - 0.35 * band * (1.0 - smoothstep(0.1, 0.3, fFw.y / cs.y));
  fBase *= 1.0 + 0.15 * pil;
}
fBase *= fGrime;
vec3 fEmit = vec3(0.0);
// Light arriving on opaque wall surfaces (added as fBase * fWallLight at the end).
vec3 fWallLight = vec3(0.0);
float fRough = mix(0.75, 0.97, fWall.a);
float fMetal = (fMat == 2 || fMat == 6) ? 0.35 : 0.0;
// Relief from the material's luminance.
fNormalW = normalize(fNormalW - (fT * fGrad.x + fB * fGrad.y) * 2.5);

if (fType == T_ATLAS) {
  // Photographic tower facade: bundle and facade per building, offset by whole bays/floors.
  int bundle = int(fract(fSeed * 3.17) * 3.0);
  int fi = bundle * 7 + int(fract(fSeed * 11.3) * 7.0);
  vec4 R = TF_RECT[fi];
  vec4 Dm = TF_DIM[fi];
  float perM = Dm.x / CELL_CURTAIN.y;
  vec2 L = fUv * perM + vec2(floor(fract(fSeed * 5.1) * 9.0) * Dm.y, floor(fract(fSeed * 7.9) * 9.0) * Dm.x);
  vec2 Lw = mod(L, Dm.zw);
  vec2 auv = vec2(R.x + Lw.x, 1.0 - R.w + Lw.y);
  vec4 dr; vec3 em, nm;
  towerSample(bundle, auv, dFdx(L), dFdy(L), dr, em, nm);
  fBase = dr.rgb * 0.5;
  fRough = dr.a;
  fMetal = (1.0 - dr.a) * 0.4;
  float floorId = floor(L.y / Dm.x);
  float floorLit = mix(0.35, 1.25, fHash(vec2(floorId, fSeed * 31.0))) * step(0.18, fHash(vec2(floorId, fSeed * 13.0 + 2.0)));
  fEmit = em * 2.0 * floorLit;
  // Spill: the emissive map blurred over ~a bay lights the frames and spandrels around windows.
  vec4 drB; vec3 emB, nmB;
  towerSample(bundle, auv, dFdx(L) + vec2(Dm.y * 0.8, 0.0), dFdy(L) + vec2(0.0, Dm.x * 0.8), drB, emB, nmB);
  fWallLight += emB * floorLit * 0.8;
  vec3 n = nm * 2.0 - 1.0;
  fNormalW = normalize(fT * n.x + fB * n.y + normalize(vFNormal) * max(n.z, 0.2));
  // Glass picks up the sky glow.
  float glassAmt = 1.0 - smoothstep(0.3, 0.6, dr.a);
  fEmit += glassAmt * skyRefl(reflect(-fV, fNormalW)) * (0.06 + 0.6 * pow(1.0 - max(fVt.z, 0.0), 4.0));
} else if (fType == T_RES || fType == T_OFFICE || fType == T_CURTAIN || fType == T_CAGE) {
  vec3 wEmit, cellEmit, rowEmit, avgEmit, wSpill, wAvgSpill; float wMask, wFrame, wFrac, wAround;
  windowLayer(fType == T_CAGE ? T_RES : fType, fUv, fFw, fType == T_CAGE ? 1.0 : fFill, fSeed, fVt,
              wEmit, wMask, wFrame, cellEmit, rowEmit, avgEmit, wFrac, wAround, wSpill, wAvgSpill);
  // Anti-aliasing: detail → cell mean → floor mean → facade mean by pixel footprint.
  vec2 cellSize = fType == T_OFFICE ? CELL_OFFICE : fType == T_CURTAIN ? CELL_CURTAIN : CELL_RES;
  float px = max(fFw.x / cellSize.x, fFw.y / cellSize.y);
  float toCell = smoothstep(0.22, 0.45, px);
  float toRow = smoothstep(0.5, 1.2, fFw.x / cellSize.x);
  float toAvg = smoothstep(0.5, 1.2, fFw.y / cellSize.y);
  vec3 e = mix(mix(mix(wEmit, cellEmit, toCell), rowEmit, toRow), avgEmit, toAvg);
  float m = mix(mix(wMask, wFrac * fFill, toCell), wFrac * fFill, toAvg);
  float detail = 1.0 - toCell;
  vec3 glass = fType == T_CURTAIN ? mix(P_GLASS, P_METAL, 0.3) : P_GLASS;
  if (fType == T_CURTAIN) fBase = mix(P_METAL, P_CONCRETE_DARK, 0.3 * fTint);
  // Recess shadow around the opening.
  fBase *= 1.0 - 0.45 * wAround * detail;
  fBase = mix(fBase, glass, m);
  fBase = mix(fBase, P_METAL * 1.3, wFrame * detail);
  fRough = mix(fRough, 0.15, m * (1.0 - wFrame));
  fEmit = e;
  // Window light on the surrounding wall (lights the wall's own albedo).
  fWallLight += mix(wSpill, wAvgSpill, toCell);
  if (fType == T_CAGE) {
    float bars = max(1.0 - fBox(fract(fUv.x / 0.12), 0.15, 0.85, fFw.x / 0.12), 1.0 - fBox(fract(fUv.y / 0.4), 0.06, 0.94, fFw.y / 0.4));
    // Bars are 12 cm apart: fade to their average coverage before they alias (< ~8 px period).
    bars = mix(bars, 0.45, smoothstep(0.04, 0.16, max(fFw.x / 0.12, fFw.y / 0.4)));
    fBase = mix(fBase * 0.6, P_METAL * 1.4, bars);
    fEmit *= (1.0 - bars) * 0.8;
    fRough = mix(0.7, 0.5, bars);
    fMetal = bars * 0.4;
  }
} else if (fType == T_PODIUM) {
  float sid = floor(fUv.x / CELL_PODIUM.x);
  float x = fUv.x - sid * CELL_PODIUM.x;
  float s = fSeed * 31.7;
  float present = step(fHash(vec2(sid, s)), fFill);
  float open = step(fHash(vec2(sid, s + 1.3)), 0.5) * present;
  float hCol = fHash(vec2(sid, s + 2.1));
  vec3 shopCol = hCol < 0.5 ? P_FLUORESCENT : hCol < 0.85 ? P_TUNGSTEN : mix(P_FLUORESCENT, P_TV, 0.5);
  float pier = 1.0 - fBox(x, 0.3, CELL_PODIUM.x - 0.3, fFw.x);
  float glassMask = fBox(fUv.y, 0.15, 3.25, fFw.y) * (1.0 - pier) * present;
  float racks = 0.75 + 0.25 * sin(x * 7.0 + s) * sin(x * 2.3 + s * 3.0);
  float stock = mix(0.45, 1.0, smoothstep(0.3, 2.2, fUv.y)) * (0.8 + 0.2 * fNoise(vec2(x * 1.5 + s, fUv.y * 0.8)));
  float strip = 1.6 * fBox(fUv.y, 2.95, 3.1, fFw.y);
  float counter = 1.0 - 0.6 * fBox(fUv.y, 0.15, 1.05, fFw.y) * fBox(x, 0.6, 2.8 + 1.4 * fHash(vec2(sid, s + 7.0)), fFw.x);
  vec3 goods = mix(vec3(1.0), mix(P_TUNGSTEN, P_RED, fHash(vec2(floor(x / 0.7), sid + s))), 0.35 * fBox(fUv.y, 1.2, 2.6, fFw.y));
  float glow = mix(0.45, 1.3, fHash(vec2(sid, s + 4.4))) * (racks * stock * counter + strip);
  shopCol *= goods;
  float ribs = 0.6 + 0.4 * smoothstep(0.3, 0.7, abs(fract(fUv.y * 7.0) - 0.5) * 2.0);
  vec3 shutter = mix(P_METAL * 2.2, fBase, 0.3) * ribs * mix(0.6, 1.0, fGrime);
  fBase = mix(fBase, open > 0.5 ? P_GLASS : shutter, glassMask);
  fEmit = glassMask * open * shopCol * glow;
  fBase *= 1.0 - 0.4 * fBox(fUv.y, 3.35, 4.5, fFw.y);
  fRough = mix(fRough, open > 0.5 ? 0.2 : 0.6, glassMask);
  fMetal = (1.0 - open) * glassMask * 0.4;
} else if (fType == T_ROOF) {
  fBase *= 0.7;
} else if (fType == T_TRIM) {
  fBase *= 1.05;
} else if (fType == T_METAL) {
  fBase = P_METAL * mix(0.7, 1.6, fNoise(fUv * 2.0 + fSeed * 9.0));
  fRough = 0.55;
  fMetal = 0.5;
  fNormalW = normalize(vFNormal);
} else if (fType == T_SOFFIT) {
  float tubes = fBox(fract(fUv.y / 1.1), 0.46, 0.54, fFw.y / 1.1) * fBox(fract(fUv.x / 1.8), 0.08, 0.92, fFw.x / 1.8)
    * step(0.25, fHash(vec2(floor(fUv.x / 1.8), fSeed * 11.0)));
  fBase = P_CONCRETE_DARK;
  fEmit = P_FLUORESCENT * (0.04 + 1.3 * tubes);
} else if (fType == T_SCREEN) {
  // Video screen: abstract animated content (no real ads), LED pixel grid up close.
  vec2 sp = vRawUv;
  float sid = fFill * 17.0 + fTint * 5.0 + fSeed * 3.0;
  float clip = floor(uTime / 7.0 + sid);
  float ct = fract(uTime / 7.0 + sid);
  float pick = fHash(vec2(clip, sid));
  vec3 ca = pick < 0.3 ? P_RED : pick < 0.55 ? P_CYAN : pick < 0.8 ? P_AMBER : P_TV;
  vec3 cb = fHash(vec2(clip, sid + 1.0)) < 0.5 ? P_FLUORESCENT : P_TV * 0.6;
  vec3 img = mix(ca, cb, smoothstep(0.0, 1.0, sp.y + 0.3 * sin(ct * 6.28 + sp.x * 3.0)));
  vec2 blob = vec2(0.3 + 0.4 * fHash(vec2(clip, sid + 2.0)) + 0.1 * sin(ct * 6.28), 0.55);
  img = mix(img, vec3(1.0, 0.95, 0.9), smoothstep(0.28, 0.2, length((sp - blob) * vec2(1.0, 1.6))) * 0.8);
  float lines = fBox(sp.y, 0.08, 0.3, 0.004) * step(0.35, fNoise(vec2(floor(sp.x * 18.0 - ct * 12.0), floor(sp.y * 14.0) + clip)));
  img = mix(img, vec3(1.0), lines * 0.7);
  img *= 0.8 + 0.2 * smoothstep(0.0, 0.1, ct) ;
  // LED pixels: visible up close, averaged away with distance.
  vec2 led = fract(sp * vec2(160.0, 240.0));
  float px = max(fwidth(sp.x) * 160.0, fwidth(sp.y) * 240.0);
  float dots = mix(fBox(led.x, 0.15, 0.85, 0.05) * fBox(led.y, 0.15, 0.85, 0.05), 0.5, smoothstep(0.3, 0.8, px));
  fBase = P_METAL;
  fEmit = img * img * dots * 1.6;
  fRough = 0.3;
  fNormalW = normalize(vFNormal);
} else if (fType == T_FIXTURE) {
  // fixture_colors in facade.json: sodium 0, white 0.25, cyan 0.5, blue 0.75, red 1.
  vec3 fc = fFill < 0.125 ? P_SODIUM : fFill < 0.375 ? P_FLUORESCENT : fFill < 0.625 ? P_CYAN : fFill < 0.875 ? P_TV : P_RED;
  float blink = fFill > 0.875 ? step(0.5, fract(uTime * 0.9 + fSeed * 3.0)) : 1.0;
  fBase = fc * 0.2;
  // Accent strips glow softly; small point fixtures (lamps, aviation lights) burn hot.
  bool strip = fTint > 0.5;   // lib/surface.py fixture(strip=True)
  fEmit = fc * (strip ? 1.4 : 4.0) * blink;
  fNormalW = normalize(vFNormal);
}

// Street light spilling up the lower floors: sample the lamp map a little in front of the wall.
vec2 fLampUv = (vFWorld.xz + vFNormal.xz * 2.5 - uLampRect.xy) * uLampRect.zw;
float fLamp = texture2D(uLampMap, fLampUv).r;
fEmit += fBase * P_SODIUM * fLamp * 1.5 * exp(-max(vFWorld.y - 1.0, 0.0) / 7.0);
// Canyon glow: the lit street below (lamp and sign maps, blurred wide) reflects off the wet
// ground and opposite walls and climbs the facades, fading over ~25 m.
vec2 fWideUv = (vFWorld.xz - uLampRect.xy) * uLampRect.zw;
vec3 fStreet = P_SODIUM * texture(uLampMap, fWideUv, 4.5).r * 0.5 + texture(uSignMap, fWideUv, 4.5).rgb * 0.35;
float fUpFacing = fType == T_ROOF ? 0.25 : 1.0;
fWallLight += fStreet * 0.5 * exp(-max(vFWorld.y, 0.0) / 20.0) * fUpFacing;
// City bounce: a faint warm fill from everything lit around, so walls never go fully black.
fWallLight += mix(P_HAZE * 2.2, P_SODIUM * 0.25, 0.12) * 0.45;
// Sky rim: grazing faces catch the glowing sky, separating silhouettes in depth.
float fRim = pow(1.0 - max(fVt.z, 0.0), 3.0) * (0.5 + 0.5 * normalize(vFNormal).y + 0.5);
fWallLight += skyRefl(vec3(0.0, 0.05, 0.0)) * fRim * 0.35 + P_HAZE * 0.05;
// Colored light from nearby signs, up to about the height signs hang at.
vec3 fSign = texture2D(uSignMap, (vFWorld.xz + vFNormal.xz * 1.5 - uLampRect.xy) * uLampRect.zw).rgb;
fEmit += fBase * fSign * 0.6 * exp(-max(vFWorld.y - 14.0, 0.0) / 8.0) * smoothstep(0.0, 3.0, vFWorld.y);

if (fType != T_FIXTURE && fType != T_SCREEN) fEmit += fBase * fWallLight;
fEmit *= fType == T_FIXTURE || fType == T_SOFFIT || fType == T_SCREEN ? 1.0 : uWindowGain;
diffuseColor.rgb = fBase;
`;

export function createFacadeMaterial(uniforms: FacadeUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: true });
  material.name = 'facade';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <batching_vertex>', VERTEX_INSTANCE)
      .replace('#include <project_vertex>', VERTEX_WORLD)
      // vColor is data here; keep three's color_vertex from multiplying anything.
      .replace('#include <color_vertex>', '');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(fNormalW, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = fEmit;');
  };
  material.customProgramCacheKey = () => 'facade-v2';
  return material;
}

export function createFacadeUniforms(time: { value: number }, seed: number, textures: FacadeTextures | null): FacadeUniforms {
  const t = textures;
  return {
    uTime: time,
    uSeed: { value: seed },
    uLampMap: { value: null },
    uLampRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uWindowGain: { value: 1 },
    uTowerDiff0: { value: t?.diffuse[0] ?? null },
    uTowerDiff1: { value: t?.diffuse[1] ?? null },
    uTowerDiff2: { value: t?.diffuse[2] ?? null },
    uTowerEmit0: { value: t?.emissive[0] ?? null },
    uTowerEmit1: { value: t?.emissive[1] ?? null },
    uTowerEmit2: { value: t?.emissive[2] ?? null },
    uTowerNorm0: { value: t?.normal[0] ?? null },
    uTowerNorm1: { value: t?.normal[1] ?? null },
    uTowerNorm2: { value: t?.normal[2] ?? null },
    uWalls: { value: t?.walls ?? null },
    uSignMap: { value: null },
  };
}
