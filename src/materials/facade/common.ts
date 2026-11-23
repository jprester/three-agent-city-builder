import { DEFINES } from './constants';

// Fragment declarations shared by every surface: uniforms, varyings, hashes and filtering,
// tower atlas and wall material lookups, interior mapping (rooms and room cards) and the
// light colour of a lit window. FRAGMENT_COMMON + FRAGMENT_WINDOWS go after #include <common>.
export const FRAGMENT_COMMON = /* glsl */ `
${DEFINES}
uniform float uTime;
uniform float uNight;
uniform sampler2D uLampMap;
uniform vec4 uLampRect;
uniform float uWindowGain;
uniform float uCityGlow;
uniform float uDay;
uniform int uFacadePick;
uniform float uGridOverlay;
uniform highp sampler2DArray uTowerDiff, uTowerEmit, uTowerNorm;
uniform sampler2D uWalls;
uniform sampler2D uInteriors;
uniform highp sampler2D uTowerRooms;
uniform sampler2D uSignMap;
uniform sampler2D uScreens;
uniform samplerCube uGlassEnv;
uniform float uGlassOn, uGlassGain;
flat varying vec3 vFace;
varying vec2 vFacadeUv;
// Discrete face data and random seeds must not acquire interpolation rounding noise.
flat varying vec3 vSurf;
flat varying float vInstSeed;
flat varying float vInstPaint;
flat varying float vInstBrake;
flat varying vec2 vInstSignal;
varying vec3 vFWorld;
varying vec3 vFNormal;
varying vec2 vRawUv;

// World-space shading normal chosen by the surface code, applied in normal_fragment_maps.
vec3 fNormalW;
// Per-building share of lit residential windows (min, max); residential towers raise it.
vec2 fLitRange = vec2(0.4, 0.7);
// Office/curtain lighting: x = curtain lit multiplier, y = share of dark floors, z = share of
// light pushed to cool office white. Glass commercial blocks raise all three.
vec3 fOffice = vec3(0.3, 0.45, 0.0);
// Glass commercial skins: continuous glazing, whole floors lit at an even brightness.
bool fGlassSkin = false;

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
// Exact coverage of an interval by a pixel footprint. Unlike a smoothed point sample,
// this preserves energy when the opening becomes smaller than a pixel.
float fCoverage(float x, float lo, float hi, float footprint) {
  float width = max(footprint, 1e-4);
  return clamp((min(x + width * 0.5, hi) - max(x - width * 0.5, lo)) / width, 0.0, 1.0);
}
float windowCoverage(vec2 p, vec4 rect, vec2 footprint) {
  return fCoverage(p.x, rect.x, rect.y, footprint.x) * fCoverage(p.y, rect.z, rect.w, footprint.y);
}
// The night sky as a reflection: glow at the horizon, dark overhead.
vec3 skyRefl(vec3 r) {
  float y = max(r.y, 0.0);
  return mix(P_HAZE * 1.6 + P_SODIUM * 0.03, P_SKY, smoothstep(0.0, 0.5, y));
}

// Scale for coordinates in a module (vFace: xy in meters at this instance's scale, 0 = none)
// so it holds a whole number of cells of size cell (per axis; cell 0 = leave that axis). The
// cells stretch by at most half a cell over the module. A locked module (vFace.z: real
// geometry sits on its cells, e.g. recessed openings, shopfront jambs) is left as built.
vec2 fWholeFit(vec3 m, vec2 cell) {
  vec2 c = max(cell, vec2(1e-3));
  vec2 ok = step(1e-3, m.xy) * step(1e-3, cell) * (1.0 - step(0.5, m.z));
  vec2 n = max(floor(m.xy / c + 0.5), vec2(1.0));
  return mix(vec2(1.0), n * cell / max(m.xy, vec2(1e-3)), ok);
}

void towerSample(int bundle, vec2 uv, vec2 dx, vec2 dy, out vec4 dr, out vec3 em, out vec3 nm) {
  vec3 l = vec3(uv, float(bundle));
  dr = textureGrad(uTowerDiff, l, dx, dy); em = textureGrad(uTowerEmit, l, dx, dy).rgb; nm = textureGrad(uTowerNorm, l, dx, dy).rgb;
}

// Wall material cell m (4×2 atlas of 1024 px slots, tools/textures/pack_walls.py) at facade
// meters uvm, one tile per 'size' meters. The materials are seamless and each slot carries a
// 32 px wrap-around gutter, so they simply repeat. Returns diffuse+roughness and a luminance
// gradient for relief.
vec4 wallSample(int m, vec2 uvm, float size, out vec2 grad) {
  vec2 cell = vec2(float(m - (m / 4) * 4) * 0.25, 1.0 - float(m / 4 + 1) * 0.5);
  vec2 l = uvm / size;
  vec2 k = vec2(960.0 / 4096.0, 960.0 / 2048.0);
  vec2 uv = cell + vec2(32.0 / 4096.0, 32.0 / 2048.0) + fract(l) * k;
  vec2 dx = dFdx(l) * k, dy = dFdy(l) * k;
  vec4 s = textureGrad(uWalls, uv, dx, dy);
  vec2 e = vec2(1.5 / 4096.0, 0.0);
  float lx = dot(textureGrad(uWalls, uv + e.xy, dx, dy).rgb, vec3(0.333));
  float ly = dot(textureGrad(uWalls, uv + e.yx * 2.0, dx, dy).rgb, vec3(0.333));
  float l0 = dot(s.rgb, vec3(0.333));
  // Relief fades out once a texel is smaller than a pixel.
  grad = vec2(lx - l0, ly - l0) * (1.0 - smoothstep(0.3, 1.5, length(dx) * 4096.0));
  return s;
}

// Interior mapping: the room behind a window, seen through point wp (meters from the
// window's lower-left) along the tangent-space view vector vt (x right, y up, z out).
vec3 room(vec2 wp, vec2 wsize, vec3 vt, vec3 col, float h) {
  vec3 size = vec3(wsize.x + 1.4, max(2.8, wsize.y + 1.1), 3.0 + 2.5 * h);
  vec3 o = vec3(wp.x + 0.7, wp.y + 0.85, 0.0);
  vec3 d = normalize(vec3(-vt.x, -vt.y, max(vt.z, 0.08)));
  // Parallel rays can otherwise create 0/0 at a room boundary and poison HDR bloom.
  vec3 safeD = mix(vec3(-1.0), vec3(1.0), step(0.0, d)) * max(abs(d), vec3(0.00001));
  vec3 tm = (step(0.0, d) * size - o) / safeD;
  float t = min(min(tm.x, tm.y), tm.z);
  vec3 p = o + d * t;
  float c;
  // Painted room walls in a few household tints.
  vec3 paint = mix(vec3(1.0, 0.92, 0.8), mix(vec3(0.75, 0.85, 0.8), vec3(0.95, 0.75, 0.7), fract(h * 13.0)), step(0.5, fract(h * 29.0)));
  if (t == tm.z) {
    // Back wall with a furniture band (shelves, a sofa back) and a picture or TV.
    c = 0.42 + 0.18 * h;
    float band = fBox(p.y, 0.0, 0.9 + 0.5 * fract(h * 7.0), 0.02) * fBox(p.x, size.x * fract(h * 3.0) * 0.5, size.x * (0.5 + 0.5 * fract(h * 5.0)), 0.02);
    c = mix(c, 0.045, band);
    c = mix(c, 0.22, fBox(p.y, 1.4, 1.9, 0.02) * fBox(p.x, 0.6, 1.3, 0.02) * step(0.5, fract(h * 11.0)));
  } else if (t == tm.y) {
    c = d.y > 0.0 ? 0.85 : 0.09;    // ceiling / floor
    paint = d.y > 0.0 ? vec3(1.0) : vec3(0.8, 0.6, 0.45);
  } else {
    c = 0.32;                      // side walls
    // A wardrobe or shelf against one side wall.
    c = mix(c, 0.12, fBox(p.z, 0.5, 1.6, 0.02) * fBox(p.y, 0.0, 2.0, 0.02) * step(0.4, fract(h * 17.0)));
  }
  // Ceiling lamp offset per room to avoid uniformly illuminated panes.
  vec3 lamp = vec3(size.x * mix(0.25, 0.75, h), size.y - 0.1, size.z * 0.45);
  float light = 0.18 + 1.45 * exp(-dot(p - lamp, p - lamp) / 4.0);
  return col * paint * c * light;
}

// Room card behind a window: ray-cast the card's room box from the pane point ro (meters from
// the room's front-left floor corner) along the tangent-space view vt, then project the hit
// through the card camera into the tile, so walls, floor, ceiling and furniture all get
// parallax from one image (tools/blender/render_interiors.py renders with the same camera).
// Returns the card colour lit in neutral white; the caller tints it with the window's light.
vec3 interior(vec4 box, vec4 tile, vec2 ro, vec3 vt, float pxPerM, vec2 fw) {
  vec3 size = box.xyz;
  vec3 o = vec3(clamp(ro, vec2(0.01), size.xy - 0.01), 0.0);
  vec3 d = normalize(vec3(-vt.x, -vt.y, max(vt.z, 0.08)));
  vec3 safeD = mix(vec3(-1.0), vec3(1.0), step(0.0, d)) * max(abs(d), vec3(0.00001));
  vec3 tm = (step(0.0, d) * size - o) / safeD;
  vec3 h = o + d * max(min(min(tm.x, tm.y), tm.z), 0.0);
  vec2 c = size.xy * 0.5;
  float scale = box.w / (box.w + h.z);   // card size of a meter at the hit's depth
  vec2 q = clamp((c + (h.xy - c) * scale) / size.xy, 0.002, 0.998);
  // Mip from the pane footprint in card pixels at that depth (the back wall is drawn smaller,
  // so it has fewer card pixels per meter and needs a finer level).
  float lod = log2(max(max(fw.x, fw.y) * pxPerM * scale, 1.0));
  return textureLod(uInteriors, mix(tile.xy, tile.zw, q), lod).rgb;
}

// Shared window colour and brightness keep interior light and wall spill consistent.
// Warm whites dominate; a TV colours a room faintly rather than becoming a blue panel.
// Homes: mostly warm lamps from deep amber to pale tungsten, a few neutral, a few cool
// fluorescent (they make the warm ones read warm), and the odd TV.
vec3 windowColor(float h) {
  if (h < 0.62) return mix(P_TUNGSTEN * vec3(1.0, 0.8, 0.56), P_TUNGSTEN * vec3(1.0, 0.95, 0.88), h / 0.62);
  if (h < 0.85) return mix(P_TUNGSTEN, P_FLUORESCENT, 0.3);
  if (h < 0.98) return mix(P_FLUORESCENT, P_TUNGSTEN, 0.35);
  return mix(P_TV, P_FLUORESCENT, 0.55);
}
float windowIntensity(vec2 cid, float s) {
  float h = fHash(cid + s + 2.9);
  float intensity = mix(0.45, 3.0, h * h * h);
  if (fHash(cid + s + 5.3) >= 0.98) {
    float hm = fHash(cid + s + 9.1);
    intensity *= 0.35 + 0.65 * fNoise(vec2(uTime * (5.0 + 9.0 * hm) + hm * 40.0, hm * 13.0));
  }
  return intensity;
}
`;
