import * as THREE from 'three/webgpu';
import atlasUrl from '../../art/textures/signs/designs.png?url';
import {
  Fn, If, abs, attribute, dFdx, dFdy, dot, floor, float, fract, ivec2, length, max, min, mix, property, select, sin, smoothstep, step,
  texture, textureSize, varying, vec2, vec3,
  P, type N,
} from './tsl';

/**
 * The typeset sign atlas (art/textures/signs, built from real fonts): channels are data.
 *   R ink / tube coverage   G part id × coverage   B backlit face (lightboxes)
 */
export async function loadSignAtlas(): Promise<THREE.Texture> {
  const t = await new THREE.TextureLoader().loadAsync(atlasUrl);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/**
 * Sign boxes: the design on the ±Z faces, dark metal elsewhere. Neon is a white-hot core with
 * a coloured halo from a coarse mip; lightboxes are a lit face with printed characters. Part
 * ids are read unfiltered, so a dead or flickering part is a whole character.
 */
export function createSignMaterial(atlas: THREE.Texture, time: N): THREE.MeshStandardNodeMaterial {
  const flat = (node: N): N => varying(node).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.FIRST);
  const nrm = attribute('normal', 'vec3') as N, uv0 = attribute('uv', 'vec2') as N, aRect = attribute('aRect', 'vec4') as N;
  const vUv = varying(aRect.xy.add(uv0.mul(aRect.zw))) as N;
  const vFace = varying(select(abs(nrm.z).greaterThan(0.5), float(1), float(0))) as N;
  const vTube = flat(attribute('aTube', 'vec3')), vBack = flat(attribute('aBack', 'vec3'));
  const vParams = flat(attribute('aParams', 'vec4')), vGain = flat(attribute('aGain', 'float'));
  const atlasTex = texture(atlas) as N;
  const pEmit = property('vec3') as N;
  const sHash = (x: N): N => fract(sin(x.mul(127.1)).mul(43758.5453));
  const lum = (c: N): N => dot(c, vec3(0.299, 0.587, 0.114));

  const surface = Fn(() => {
    const diffuse = vec3(P('metal_dark')).toVar();
    const emit = vec3(0).toVar();
    If(vFace.greaterThan(0.5), () => {
      const s = atlasTex.sample(vUv).grad(dFdx(vUv), dFdy(vUv)).toVar();
      const glow = atlasTex.sample(vUv).level(3.5).r;
      const size = vec2(textureSize(atlasTex, 0));
      const texel = atlasTex.load(ivec2(min(max(vUv.mul(size), vec2(0)), size.sub(1)))).toVar();
      const id = floor(texel.g.div(max(texel.r, 1 / 255)).mul(255).add(0.5)).toVar();
      const seed = vParams.y.mul(1000).toVar();
      const alive = step(vParams.z, sHash(id.add(seed)));
      const flickers = vParams.w.greaterThan(0).and(sHash(id.mul(3.1).add(seed)).lessThan(vParams.w));
      const fl = select(flickers, step(0.35, fract(sin(floor(time.mul(12).add(id)).mul(91.7).add(seed)).mul(4375.85))), float(1));
      const footprint = max(length(dFdx(vUv.mul(size))), length(dFdy(vUv.mul(size))));
      const on = mix(alive.mul(fl), vParams.z.oneMinus(), smoothstep(1, 3, footprint)).toVar();
      If(vParams.x.greaterThan(0.5), () => {
        const inverse = fract(vParams.y.mul(7.3)).lessThan(0.5);
        const face = select(inverse, vTube.mul(0.7), mix(vBack, vec3(1), 0.25).mul(0.45)).toVar();
        const ink = select(inverse, mix(vTube, vec3(1), 0.8).mul(1.4), vTube.mul(1.5)).toVar();
        // Pale characters on a pale face are illegible: print them dark, like a real lightbox.
        If(lum(face).greaterThan(0.22).and(lum(ink).lessThan(lum(face).mul(2.5))), () => {
          ink.assign(mix(ink, vec3(0.015, 0.015, 0.018), 0.96));
          face.mulAssign(0.88);
        });
        emit.assign(s.b.mul(s.r.oneMinus()).mul(face).add(s.r.mul(ink).mul(on)).mul(vGain));
        diffuse.assign(mix(diffuse, vec3(0.5), s.b));
      }).Else(() => {
        emit.assign(s.r.mul(mix(vTube, vec3(1), 0.12)).mul(2.4).mul(on).add(vTube.mul(glow).mul(1.4).mul(on)).mul(vGain));
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
