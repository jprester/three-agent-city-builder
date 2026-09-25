import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import palette from '../../art/style/palette.json';
import { FOG_FALLOFF } from './fog';

const sodium = new THREE.Color(palette.sodium);
const haze = new THREE.Color(palette.haze);
const v3 = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

/**
 * City haze: light scattered into the air by the city. For every pixel the view ray is
 * marched through the height fog (same falloff as src/scene/fog.ts) up to the depth-buffer
 * hit, and at each step the air is lit by the street lights and signs below it, read from
 * the top-down lamp and sign maps at a coarse mip. Streets glow up into the haze, lit
 * districts get a glow dome, and distance fills with warm-tinted air instead of flat color.
 * Runs in HDR before bloom, so the glow blooms too.
 */
export class CityHazeEffect extends Effect {
  constructor(private readonly camera: THREE.PerspectiveCamera, lampMap: THREE.Texture | null, signMap: THREE.Texture | null, rect: THREE.Vector4) {
    super('CityHazeEffect', /* glsl */ `
      uniform mat4 uProjInv;
      uniform mat4 uCamWorld;
      uniform vec3 uCamPos;
      uniform sampler2D uLampMap;
      uniform sampler2D uSignMap;
      uniform vec4 uRect;
      uniform float uDensity;
      uniform float uGain;
      const int STEPS = 18;
      const float MAX_DIST = 2400.0;

      float hHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

      // Light in the air at p: street and sign light, spread wide and fading with height,
      // plus a faint district glow that reaches higher.
      vec3 airLight(vec3 p) {
        vec2 uv = (p.xz - uRect.xy) * uRect.zw;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        vec3 near = ${v3(sodium)} * textureLod(uLampMap, uv, 4.0).r * 0.4 + textureLod(uSignMap, uv, 4.0).rgb * 0.6;
        vec3 wide = ${v3(sodium)} * textureLod(uLampMap, uv, 7.0).r * 0.45 + textureLod(uSignMap, uv, 7.0).rgb * 0.4;
        float y = max(p.y, 0.0);
        return inside * (near * exp(-y / 28.0) + wide * exp(-y / 80.0));
      }

      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 vp = uProjInv * ndc;
        vp /= vp.w;
        vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
        vec3 rd = wp - uCamPos;
        float dist = min(length(rd), MAX_DIST);
        rd = normalize(rd);
        // Steps grow with distance (near detail, far reach); per-pixel jitter hides banding.
        float jitter = hHash(uv * 1024.0);
        vec3 scatter = vec3(0.0);
        float T = 1.0;
        float prev = 0.0;
        for (int i = 1; i <= STEPS; i++) {
          float f = (float(i) - 1.0 + jitter) / float(STEPS);
          float t = dist * f * f;
          float dt = t - prev;
          prev = t;
          vec3 p = uCamPos + rd * t;
          float dens = uDensity * exp(-max(p.y, 0.0) * ${FOG_FALLOFF.toFixed(6)}) + 0.00018;
          vec3 L = airLight(p) + ${v3(haze)} * 0.15;
          scatter += T * dens * dt * L;
          T *= exp(-dens * dt);
        }
        outputColor = vec4(inputColor.rgb + scatter * uGain, inputColor.a);
      }`, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uLampMap', new THREE.Uniform(lampMap)],
        ['uSignMap', new THREE.Uniform(signMap)],
        ['uRect', new THREE.Uniform(rect)],
        ['uDensity', new THREE.Uniform(0.0016)],
        ['uGain', new THREE.Uniform(1.0)],
      ]),
    });
  }

  get gain() {
    return this.uniforms.get('uGain')!;
  }

  update() {
    this.camera.updateMatrixWorld();
    this.uniforms.get('uProjInv')!.value.copy(this.camera.projectionMatrixInverse);
    this.uniforms.get('uCamWorld')!.value.copy(this.camera.matrixWorld);
    this.uniforms.get('uCamPos')!.value.setFromMatrixPosition(this.camera.matrixWorld);
  }
}
