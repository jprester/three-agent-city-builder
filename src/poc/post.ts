import * as THREE from 'three/webgpu';
import {
  Fn, Loop, agxToneMapping, clamp, distance, dot, exp, float, fract, getViewPosition, int, length, max, min, mix, pass, pow, screenCoordinate,
  screenUV, sin, smoothstep, step, texture, uniform, vec2, vec3, vec4,
} from './tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';
import { FOG_FALLOFF } from '../scene/fog';
import { GRADE_PRESETS, type GradeName } from '../scene/post';
import type { QualityPreset } from '../systems/quality';
import { P, colorNode, mapUv, paletteColor, type N } from './tsl';

export interface PocPost {
  pipeline: THREE.RenderPipeline;
  /** Call before render: the haze reads the scene camera, not the post quad's. */
  update(): void;
}

export interface HazeInputs {
  lampMap: THREE.Texture;
  signMap: THREE.Texture;
  lampRect: N;
  time: N;
  density: N;
}

/**
 * The post chain of src/scene/post.ts on three's node post-processing: scene pass (half
 * float) → city haze → bloom → AgX → the night grade → vignette and grain → SMAA. The grade
 * works in display space and its result goes to the canvas as is, so the pipeline's own
 * output transform is off. Chromatic aberration (0.06 % of the frame) is left out.
 */
export function createPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: QualityPreset, gradeName: GradeName, haze: HazeInputs | null): PocPost {
  const scenePass = pass(scene, camera) as N;
  const sceneColor = scenePass.getTextureNode('output') as N;
  const sceneDepth = scenePass.getTextureNode('depth') as N;

  // The post quad has its own camera, so the haze gets the scene camera's matrices by hand.
  const uProjInv = uniform(camera.projectionMatrixInverse);
  const uCamWorld = uniform(camera.matrixWorld);
  const uCamPos = uniform(new THREE.Vector3());

  let hdr: N = sceneColor.rgb;
  if (haze) hdr = cityHaze(sceneColor, sceneDepth, haze, { uProjInv, uCamWorld, uCamPos }, quality.hazeSteps);

  // Unreal-style bloom: threshold 1 so only emissives bloom, like the WebGL chain.
  const bloomPass = bloom(vec4(hdr, 1), 0.4, 0.35, 1.0) as N;
  const lit = hdr.add(bloomPass.rgb);

  const g = GRADE_PRESETS[gradeName];
  const shadowTint = colorNode(new THREE.Color(1, 1, 1).lerp(paletteColor('tv_blue'), 0.1));
  const highTint = colorNode(new THREE.Color(1, 1, 1).lerp(paletteColor('tungsten'), 0.14));
  const toSRGB = (c: N): N => mix(pow(c, vec3(0.41666)).mul(1.055).sub(0.055), c.mul(12.92), step(c, vec3(0.0031308)));
  const lum = (c: N): N => dot(c, vec3(0.2126, 0.7152, 0.0722));
  const graded = Fn(() => {
    const mapped = agxToneMapping(lit, float(1));
    const c0 = toSRGB(max(mapped.mul(g.exposure), 0)).toVar();
    // Split curve around mid grey: gamma below, gamma above.
    const lo = pow(clamp(c0.mul(2), 0, 1), vec3(g.shadowCurve)).mul(0.5);
    const hi = pow(clamp(c0.oneMinus().mul(2), 0, 1), vec3(g.highCurve)).mul(0.5).oneMinus();
    const c = mix(lo, hi, step(vec3(0.5), c0)).toVar();
    const l = lum(c);
    c.mulAssign(mix(vec3(1), shadowTint, smoothstep(0, 0.35, l).oneMinus().mul(0.55)));
    c.mulAssign(mix(vec3(1), highTint, smoothstep(0.45, 0.95, l).mul(0.55)));
    const l2 = lum(c).toVar();
    const sat = float(g.saturation).mul(smoothstep(0.5, 1, l2).mul(g.highlightDesat).oneMinus());
    c.assign(mix(vec3(l2), c, sat));
    c.assign(c.sub(0.5).mul(g.contrast).add(0.5));
    c.addAssign(smoothstep(0, 0.5, l2).oneMinus().mul(g.lift));
    c.assign(clamp(c, 0, 1));
    // Vignette (offset 0.3, darkness 0.55) and a little grain.
    c.mulAssign(smoothstep(0.8, 0.3 * 0.799, distance(screenUV, vec2(0.5)).mul(0.55 + 0.3)));
    const grain = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
    c.mulAssign(grain.sub(0.5).mul(0.05).add(1));
    return vec4(clamp(c, 0, 1), 1);
  })();

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = quality.smaa ? smaa(graded) : graded;
  return {
    pipeline,
    update() {
      camera.updateMatrixWorld();
      uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    },
  };
}

/**
 * City haze (src/scene/haze.ts): march the view ray through the height fog up to the depth
 * hit; at each step the air is lit by the street lights and signs below it, read from the
 * top-down maps at a coarse mip.
 */
function cityHaze(sceneColor: N, sceneDepth: N, inp: HazeInputs, cam: { uProjInv: N; uCamWorld: N; uCamPos: N }, steps: number): N {
  const STEPS = Math.max(4, Math.round(steps));
  const SODIUM = P('sodium'), HAZE = P('haze');
  const cool = colorNode(paletteColor('tv_blue').lerp(paletteColor('fluorescent'), 0.55));
  const lampTex = texture(inp.lampMap) as N, signTex = texture(inp.signMap) as N;
  const GAIN = 1.02, ABSORB = 0.04, MAX_DIST = 2400;

  const airLight = (p: N): N => {
    const uv = mapUv(p.xz, inp.lampRect);
    const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
    const near = SODIUM.mul(lampTex.sample(uv).level(4).r).mul(0.35).add(signTex.sample(uv).level(4).rgb.mul(0.55));
    const city = lampTex.sample(uv).level(7).r;
    const wide = SODIUM.mul(city).mul(0.17).add(signTex.sample(uv).level(7).rgb.mul(0.37));
    const y = max(p.y, 0);
    const upper = cool.mul(city).mul(0.16);
    // Slowly moving low-level pockets, located by the practical street lights.
    const pocket = pow(sin(p.x.mul(0.065).add(sin(p.z.mul(0.09)).mul(2)).sub(inp.time.mul(0.07))).mul(0.5).add(0.5), 4);
    return inside.mul(near.mul(exp(y.div(-28))).mul(pocket.mul(exp(y.div(-9))).mul(0.8).add(1))
      .add(wide.mul(exp(y.div(-70)))).add(upper.mul(exp(y.div(-150)))));
  };

  return Fn(() => {
    const viewPos = getViewPosition(screenUV, sceneDepth.r, cam.uProjInv);
    const wp = cam.uCamWorld.mul(vec4(viewPos, 1)).xyz;
    const ray = wp.sub(cam.uCamPos).toVar();
    const dist = min(length(ray), MAX_DIST).toVar();
    const rd = ray.div(max(length(ray), 1e-4)).toVar();
    // Steps grow with distance (near detail, far reach); per-pixel jitter hides banding.
    const jitter = fract(sin(dot(screenUV.mul(1024), vec2(12.9898, 78.233))).mul(43758.5453));
    const scatter = vec3(0).toVar();
    const T = float(1).toVar(), prev = float(0).toVar();
    Loop({ start: int(1), end: int(STEPS), condition: '<=' }, ({ i }: { i: N }) => {
      const f = float(i).sub(1).add(jitter).div(STEPS);
      const t = dist.mul(f).mul(f).toVar();
      const dt = t.sub(prev);
      const p = cam.uCamPos.add(rd.mul(t)).toVar();
      const dens = inp.density.mul(exp(max(p.y, 0).mul(-FOG_FALLOFF))).add(0.00018).toVar();
      scatter.addAssign(T.mul(dens).mul(dt).mul(airLight(p).add(HAZE.mul(0.2))));
      T.mulAssign(exp(dens.mul(dt).negate()));
      prev.assign(t);
    });
    // Distance loses a little contrast and gains cool in-scatter.
    return sceneColor.rgb.mul(mix(1, T, ABSORB)).add(scatter.mul(GAIN));
  })();
}


