import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import palette from '../../art/style/palette.json';
import { FOG_FALLOFF, FOG_FLOOR } from '../scene/fog';

/**
 * Shared TSL helpers of the WebGPU proof of concept: the palette as shader constants and the
 * hash / noise / box functions the GLSL materials define one copy of each.
 *
 * Typing: @types/three types every node by its GLSL type, and real shader code (swizzles on
 * array elements, select() over mixed operands, properties shared between material inputs)
 * fights it at every line. The proof of concept therefore imports TSL through this module,
 * untyped. A full port should keep the types and pay for the casts where they are needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;
export const {
  Fn, If, Loop, abs, agxToneMapping, asin, atan, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp,
  cos, cross, dFdx, dFdy, distance, dot, exp, float, floor, fog, fract, frontFacing,
  fwidth, getViewPosition, instanceIndex, instancedArray, int, ivec2, length, mat2, max, min, mix, mod,
  normalWorld, normalize, pass, positionLocal, positionWorld, pow, property, referenceAttribute, screenCoordinate, screenSize, screenUV, select,
  sign, sin, smoothstep, sqrt, step, texture, textureSize, uniform, uniformArray, varying, vec2, vec3,
  vec4,
}: Record<string, N> = TSL;

export type PaletteName = keyof typeof palette;
export const paletteColor = (name: PaletteName) => new THREE.Color(palette[name]);
/** A palette colour as a linear vec3 constant. */
export const P = (name: PaletteName): N => {
  const c = paletteColor(name);
  return vec3(c.r, c.g, c.b);
};
export const colorNode = (c: THREE.Color): N => vec3(c.r, c.g, c.b);

/** Hash of a vec2 (Dave Hoskins), the same one as fHash / gHash in the GLSL materials. */
export const hash21: (p: N) => N = Fn(([p]: N[]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});

export const noise2: (p: N) => N = Fn(([p]: N[]) => {
  const i = floor(p).toVar();
  const f0 = fract(p);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))).toVar();
  return mix(
    mix(hash21(i), hash21(i.add(vec2(1, 0))), f.x),
    mix(hash21(i.add(vec2(0, 1))), hash21(i.add(vec2(1, 1))), f.x),
    f.y,
  );
});

export const hash31: (p: N) => N = Fn(([q]: N[]) => {
  const p = fract(q.mul(0.1031)).toVar();
  p.addAssign(dot(p, p.yzx.add(33.33)));
  return fract(p.x.add(p.y).mul(p.z));
});

export const noise3: (p: N) => N = Fn(([p]: N[]) => {
  const i = floor(p).toVar();
  const f0 = fract(p);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))).toVar();
  const h = (x: number, y: number, z: number) => hash31(i.add(vec3(x, y, z)));
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), f.x), mix(h(0, 1, 0), h(1, 1, 0), f.x), f.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), f.x), mix(h(0, 1, 1), h(1, 1, 1), f.x), f.y),
    f.z,
  );
});

/** Anti-aliased 1D box [a, b] with filter width w. */
export const box = (x: N, a: N, b: N, w: N): N =>
  smoothstep(float(a).sub(w), float(a).add(w), x).mul(smoothstep(float(b).sub(w), float(b).add(w), x).oneMinus());

/**
 * Height fog factor (0 clear .. 1 fogged) between the camera and `world`: exponential in
 * height, integrated along the view ray. The same integral as src/scene/fog.ts.
 */
export const heightFog: (world: N, density: N) => N = Fn(([world, density]: N[]) => {
  const rd = world.sub(cameraPosition).toVar();
  const t = length(rd).toVar();
  const dirY = rd.y.div(max(t, 1e-4));
  const k = dirY.mul(FOG_FALLOFF).toVar();
  const safeK = select(abs(k).lessThan(1e-5), float(1e-5), k);
  const along = select(abs(k).lessThan(1e-5), t, exp(t.mul(safeK).negate()).oneMinus().div(safeK));
  const optical = density.mul(exp(max(cameraPosition.y, 0).mul(-FOG_FALLOFF))).mul(along);
  return exp(optical.negate().sub(t.mul(FOG_FLOOR))).oneMinus();
});

/** World XZ to lamp / sign map UV (rect: minX, minZ, 1/sizeX, 1/sizeZ). */
export const mapUv = (xz: N, rect: N): N => xz.sub(rect.xy).mul(rect.zw);
