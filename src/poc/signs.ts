import * as THREE from 'three/webgpu';
import {
  Fn, If, abs, attribute, dFdx, dFdy, dot, floor, float, fract, frontFacing, int, ivec2, length, max, min, mix, positionWorld,
  property, screenCoordinate, select, sin, smoothstep, step, texture, textureSize, uniform, varying, vec2, vec3, vec4,
} from './tsl';
import type { SignArt } from '../scene/signs/art';
import { P, heightFog, type N } from './tsl';

const flat = (node: N): N => varying(node).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.FIRST);

/** Sample one of the four art atlases by source code (2..5), with explicit derivatives. */
function artSample(art: SignArt, src: N, uv: N): N {
  const dx = dFdx(uv), dy = dFdy(uv);
  const t = (i: number): N => (texture(art.atlases[i], uv) as N).grad(dx, dy);
  const out = vec4(0).toVar();
  If(src.equal(2), () => { out.assign(t(0)); })
    .ElseIf(src.equal(3), () => { out.assign(t(1)); })
    .ElseIf(src.equal(4), () => { out.assign(t(2)); })
    .Else(() => { out.assign(t(3)); });
  return out;
}

/**
 * The sign boxes of src/scene/signs/signs.ts as a node material. Same per-instance attributes
 * (aRect, aTube, aBack, aParams, aGain) and the same data-atlas decode: tube coverage in R,
 * part id in G (read unfiltered, so dead and flickering parts follow whole strokes), backlit
 * face in B, glow from a coarse mip of R.
 */
export function createSignMaterial(atlas: THREE.Texture, art: SignArt, time: N): THREE.MeshStandardNodeMaterial {
  const METAL = P('metal_dark');
  const nrm = attribute('normal', 'vec3') as N, uv0 = attribute('uv', 'vec2') as N;
  const aRect = attribute('aRect', 'vec4') as N;
  const vUv = varying(aRect.xy.add(uv0.mul(aRect.zw))) as N;
  const vFace = varying(select(abs(nrm.z).greaterThan(0.5), float(1), float(0))) as N;
  const vTube = flat(attribute('aTube', 'vec3')), vBack = flat(attribute('aBack', 'vec3'));
  const vParams = flat(attribute('aParams', 'vec4')), vGain = flat(attribute('aGain', 'float'));
  const atlasTex = texture(atlas) as N;
  const gain = uniform(1);
  const pEmit = property('vec3') as N;
  const sHash = (x: N): N => fract(sin(x.mul(127.1)).mul(43758.5453));
  const lum = (c: N): N => dot(c, vec3(0.299, 0.587, 0.114));

  const surface = Fn(() => {
    const diffuse = vec3(METAL).toVar();
    const emit = vec3(0).toVar();
    const src = int(vParams.x.add(0.5)).toVar();
    If(vFace.greaterThan(0.5).and(vParams.x.greaterThan(1.5)), () => {
      // Artwork: emissive as drawn; alpha is a separate emission mask, not opacity.
      const artwork = artSample(art, src, vUv);
      const fl = select(vParams.w.greaterThan(0), step(0.3, fract(sin(floor(time.mul(9)).mul(91.7).add(vParams.y.mul(1000))).mul(4375.85))), float(1));
      diffuse.assign(artwork.rgb.mul(0.65));
      emit.assign(artwork.rgb.mul(artwork.a).mul(vGain).mul(fl).mul(gain));
    }).ElseIf(vFace.greaterThan(0.5), () => {
      const s = atlasTex.sample(vUv).grad(dFdx(vUv), dFdy(vUv)).toVar();
      const glow = atlasTex.sample(vUv).level(3.5).r;
      // Decode part ids before filtering: coverage-filtered ids give random edge speckles.
      const size = vec2(textureSize(atlasTex, 0));
      const texel = atlasTex.load(ivec2(min(max(vUv.mul(size), vec2(0)), size.sub(1)))).toVar();
      const id = floor(texel.g.div(max(texel.r, 1 / 255)).mul(255).add(0.5)).toVar();
      const seed = vParams.y.mul(1000).toVar();
      // Broken parts stay dark; a few flicker on the shared clock.
      const alive = step(vParams.z, sHash(id.add(seed)));
      const flickers = vParams.w.greaterThan(0).and(sHash(id.mul(3.1).add(seed)).lessThan(vParams.w));
      const fl = select(flickers, step(0.35, fract(sin(floor(time.mul(12).add(id)).mul(91.7).add(seed)).mul(4375.85))), float(1));
      const footprint = max(length(dFdx(vUv.mul(size))), length(dFdy(vUv.mul(size))));
      const on = mix(alive.mul(fl), vParams.z.oneMinus(), smoothstep(1, 3, footprint)).toVar();
      If(vParams.x.greaterThan(0.5), () => {
        // Backlit box: a coloured face with near-white characters, or a pale face with
        // saturated ones; pale-on-pale prints the characters dark, like a real lightbox.
        const inverse = fract(vParams.y.mul(7.3)).lessThan(0.5);
        const face = select(inverse, vTube.mul(0.7), mix(vBack, vec3(1), 0.25).mul(0.45)).toVar();
        const ink = select(inverse, mix(vTube, vec3(1), 0.8).mul(1.4), vTube.mul(1.5)).toVar();
        If(lum(face).greaterThan(0.22).and(lum(ink).lessThan(lum(face).mul(2.5))), () => {
          ink.assign(mix(ink, vec3(0.015, 0.015, 0.018), 0.96));
          face.mulAssign(0.88);
        });
        emit.assign(s.b.mul(s.r.oneMinus()).mul(face).add(s.r.mul(ink).mul(on)).mul(gain));
        diffuse.assign(mix(diffuse, vec3(0.5), s.b));
      }).Else(() => {
        // Neon on a dark board: white-hot core, coloured halo; dead tubes read as grey glass.
        emit.assign(s.r.mul(mix(vTube, vec3(1), 0.12)).mul(2.4).mul(on).add(vTube.mul(glow).mul(1.4).mul(on)).mul(gain));
        diffuse.assign(mix(diffuse.mul(0.5), vec3(0.25), s.r.mul(on.oneMinus())));
      });
    });
    pEmit.assign(emit);
    return diffuse;
  });

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.4 });
  material.name = 'signs';
  material.colorNode = surface();
  material.emissiveNode = pEmit;
  return material;
}

/**
 * Holographic signs and brand wordmarks: additive planes, so the art's black background adds
 * nothing. Scan lines, a slow shimmer and a rare glitch; fog fades them instead of tinting.
 */
export function createHoloMaterial(atlas: THREE.Texture, art: SignArt, time: N, fogDensity: N): THREE.MeshBasicNodeMaterial {
  const uv0 = attribute('uv', 'vec2') as N;
  const aRect = attribute('aRect', 'vec4') as N;
  const vUv = varying(aRect.xy.add(uv0.mul(aRect.zw))) as N;
  const vHolo = flat(attribute('aHolo', 'vec4')), vTint = flat(attribute('aTint', 'vec3')), vRect = flat(aRect);
  const atlasTex = texture(atlas) as N;

  const color = Fn(() => {
    const src = int(vHolo.x.add(0.5)).toVar();
    const seed = vHolo.y.mul(100);
    const huv = vec2(vUv).toVar();
    // Seen from behind, mirror u within the art's rect so text reads from both sides.
    If(frontFacing.not(), () => { huv.x.assign(vRect.x.add(vRect.z).sub(huv.x.sub(vRect.x))); });
    // Rare glitch: a horizontal tear for a fraction of a second.
    const tear = vHolo.w.mul(step(0.985, fract(time.mul(0.37).add(vHolo.y.mul(13))))).mul(step(0.5, fract(huv.y.mul(23).add(time.mul(5)))));
    huv.x.addAssign(tear.mul(0.015));
    const img = vec3(0).toVar();
    If(src.equal(0), () => {
      // Design atlas (brand wordmarks): tube core from R plus a soft halo from a coarse mip.
      const core = atlasTex.sample(huv).grad(dFdx(vUv), dFdy(vUv)).r;
      const halo = atlasTex.sample(huv).level(3).r;
      img.assign(mix(vTint, vec3(1), 0.15).mul(core).add(vTint.mul(halo).mul(0.6)));
    }).Else(() => {
      // Black level: the art's near-black background must add nothing.
      img.assign(max(artSample(art, src, huv).rgb.sub(0.035), 0).mul(1.04));
    });
    const scan = sin(screenCoordinate.y.mul(1.9).add(time.mul(3))).mul(0.14).add(0.86);
    const shimmer = sin(time.mul(1.7).add(seed)).mul(0.1).add(0.9);
    const fogged = heightFog(positionWorld, fogDensity).oneMinus();
    return img.mul(vHolo.z).mul(scan).mul(shimmer).mul(fogged);
  });

  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  material.name = 'holo-signs';
  material.colorNode = color();
  return material;
}
