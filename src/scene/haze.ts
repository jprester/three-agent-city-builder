import * as THREE from 'three';
import { Effect, EffectAttribute, Pass } from 'postprocessing';
import palette from '../../art/style/palette.json';
import { FOG_FALLOFF } from './fog';

const sodium = new THREE.Color(palette.sodium);
const cool = new THREE.Color(palette.tv_blue).lerp(new THREE.Color(palette.fluorescent), 0.55);
const haze = new THREE.Color(palette.haze);
const v3 = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

const MARCH_UNIFORMS = /* glsl */ `
  uniform mat4 uProjInv;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform sampler2D uLampMap;
  uniform sampler2D uSignMap;
  uniform vec4 uRect;
  uniform float uDensity;
  uniform float uTime;
`;

/**
 * The march shared by both paths: returns the light scattered along the view ray through
 * the height fog to the depth-buffer hit (rgb) and the transmittance along it (a).
 */
const MARCH_FN = (steps: number) => /* glsl */ `
  const int STEPS = ${Math.max(4, Math.round(steps))};
  const float MAX_DIST = 2400.0;

  // Light in the air at p: street and sign light, spread wide and fading with height,
  // plus a faint district glow that reaches higher.
  vec3 airLight(vec3 p) {
    vec2 uv = (p.xz - uRect.xy) * uRect.zw;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec3 near = ${v3(sodium)} * textureLod(uLampMap, uv, 4.0).r * 0.35 + textureLod(uSignMap, uv, 4.0).rgb * 0.55;
    float city = textureLod(uLampMap, uv, 7.0).r;
    vec3 wide = ${v3(sodium)} * city * 0.17 + textureLod(uSignMap, uv, 7.0).rgb * 0.37;
    float y = max(p.y, 0.0);
    vec3 upper = ${v3(cool)} * city * 0.16;
    // Slowly moving low-level pockets, located by the practical street lights.
    float pocket = pow(0.5 + 0.5 * sin(p.x * 0.065 + sin(p.z * 0.09) * 2.0 - uTime * 0.07), 4.0);
    return inside * (near * exp(-y / 28.0) * (1.0 + pocket * exp(-y / 9.0) * 0.8)
      + wide * exp(-y / 70.0) + upper * exp(-y / 150.0));
  }

  vec4 marchHaze(vec2 uv, float depth, float jitter) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vp = uProjInv * ndc;
    vp /= vp.w;
    vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
    vec3 rd = wp - uCamPos;
    float dist = min(length(rd), MAX_DIST);
    rd = normalize(rd);
    // Steps grow with distance (near detail, far reach); per-pixel jitter hides banding.
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
      vec3 L = airLight(p) + ${v3(haze)} * 0.2;
      scatter += T * dens * dt * L;
      T *= exp(-dens * dt);
    }
    return vec4(scatter, T);
  }
`;

/** View-space distance along -z from a [0,1] perspective depth (three's perspectiveDepthToViewZ). */
const VIEW_Z = /* glsl */ `
  uniform float uNear;
  uniform float uFar;
  float viewZ(float d) { return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
  float linZ(float d) { return max(-viewZ(d), 1e-3); }
`;

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

interface HazeInputs {
  lampMap: THREE.Texture | null;
  signMap: THREE.Texture | null;
  rect: THREE.Vector4;
  time: { value: number };
  steps: number;
}

/**
 * Half-resolution march of the city haze (after the volumetric shafts of Abyssal Garden):
 * the march runs on a half-size target, one sample per 2x2 block, reading the depth of that
 * block's top-left full-res pixel. A 3x3 blur weighted by depth similarity then hides the
 * interleaved-gradient-noise jitter without bleeding across silhouettes. CityHazeEffect
 * upsamples the result with depth-aware weights (same full-res pixels, so the depths agree).
 */
export class HazeMarchPass extends Pass {
  private readonly march: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly rtMarch: THREE.WebGLRenderTarget;
  /** Blurred half-res haze: rgb in-scattered light, a transmittance. */
  readonly rtHaze: THREE.WebGLRenderTarget;

  constructor(private readonly viewCamera: THREE.PerspectiveCamera, inputs: HazeInputs) {
    super('HazeMarchPass');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.rtMarch = rt();
    this.rtHaze = rt();
    const near = new THREE.Uniform(viewCamera.near), far = new THREE.Uniform(viewCamera.far);
    this.march = new THREE.ShaderMaterial({
      name: 'HazeMarch',
      depthTest: false,
      depthWrite: false,
      uniforms: {
        depthBuffer: new THREE.Uniform(null),
        uFullSize: new THREE.Uniform(new THREE.Vector2(1, 1)),
        uProjInv: new THREE.Uniform(new THREE.Matrix4()),
        uCamWorld: new THREE.Uniform(new THREE.Matrix4()),
        uCamPos: new THREE.Uniform(new THREE.Vector3()),
        uLampMap: new THREE.Uniform(inputs.lampMap),
        uSignMap: new THREE.Uniform(inputs.signMap),
        uRect: new THREE.Uniform(inputs.rect),
        uDensity: new THREE.Uniform(0.0016),
        uTime: inputs.time as THREE.Uniform,
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform highp sampler2D depthBuffer;
        uniform vec2 uFullSize;
        ${MARCH_UNIFORMS}
        ${MARCH_FN(inputs.steps)}
        // Interleaved gradient noise (Jimenez 2014): even, cheap, blurs away in 3x3.
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        void main() {
          ivec2 lo = ivec2(gl_FragCoord.xy);
          ivec2 px = min(lo * 2, ivec2(uFullSize) - 1);
          float depth = texelFetch(depthBuffer, px, 0).r;
          vec2 uv = (vec2(px) + 0.5) / uFullSize;
          gl_FragColor = marchHaze(uv, depth, ign(gl_FragCoord.xy));
        }`,
    });
    this.blur = new THREE.ShaderMaterial({
      name: 'HazeBlur',
      depthTest: false,
      depthWrite: false,
      uniforms: {
        depthBuffer: this.march.uniforms.depthBuffer,
        uFullSize: this.march.uniforms.uFullSize,
        tHaze: new THREE.Uniform(this.rtMarch.texture),
        uNear: near,
        uFar: far,
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform highp sampler2D depthBuffer;
        uniform sampler2D tHaze;
        uniform vec2 uFullSize;
        ${VIEW_Z}
        float zAt(ivec2 lo) { return linZ(texelFetch(depthBuffer, min(lo * 2, ivec2(uFullSize) - 1), 0).r); }
        void main() {
          ivec2 p = ivec2(gl_FragCoord.xy);
          ivec2 mx = textureSize(tHaze, 0) - 1;
          float zc = zAt(p);
          vec4 acc = vec4(0.0);
          float ws = 0.0;
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              ivec2 q = clamp(p + ivec2(x, y), ivec2(0), mx);
              float w = 1.0 / (0.03 + abs(zAt(q) - zc) / zc);
              acc += texelFetch(tHaze, q, 0) * w;
              ws += w;
            }
          }
          gl_FragColor = acc / ws;
        }`,
    });
  }

  override setDepthTexture(depthTexture: THREE.Texture) {
    this.march.uniforms.depthBuffer.value = depthTexture;
  }

  override setSize(width: number, height: number) {
    const w = Math.max(1, (width + 1) >> 1), h = Math.max(1, (height + 1) >> 1);
    this.rtMarch.setSize(w, h);
    this.rtHaze.setSize(w, h);
    this.march.uniforms.uFullSize.value.set(width, height);
  }

  override render(renderer: THREE.WebGLRenderer) {
    const cam = this.viewCamera;
    cam.updateMatrixWorld();
    const u = this.march.uniforms;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    this.blur.uniforms.uNear.value = cam.near;
    this.blur.uniforms.uFar.value = cam.far;
    this.fullscreenMaterial = this.march;
    renderer.setRenderTarget(this.rtMarch);
    renderer.render(this.scene, this.camera);
    this.fullscreenMaterial = this.blur;
    renderer.setRenderTarget(this.rtHaze);
    renderer.render(this.scene, this.camera);
  }

  override dispose() {
    super.dispose();
    this.rtMarch.dispose();
    this.rtHaze.dispose();
    this.march.dispose();
    this.blur.dispose();
  }
}

/**
 * City haze: light scattered into the air by the city. For every pixel the view ray is
 * marched through the height fog (same falloff as src/scene/fog.ts) up to the depth-buffer
 * hit, and at each step the air is lit by the street lights and signs below it, read from
 * the top-down lamp and sign maps at a coarse mip. Streets glow up into the haze, lit
 * districts get a cool upper glow and practical warm light stays near the street.
 * Runs in HDR before bloom, so the glow blooms too. `steps` (quality preset) sets the march
 * length: four texture reads per step per sample.
 *
 * By default the march runs at half resolution (`march`, a HazeMarchPass that must run
 * before this effect) and this effect only upsamples it; `halfRes = false` (`?haze=full`)
 * keeps the original per-pixel march for comparison.
 */
export class CityHazeEffect extends Effect {
  /** The half-res march pass to add before this effect, or null for the full-res path. */
  readonly march: HazeMarchPass | null;

  constructor(private readonly camera: THREE.PerspectiveCamera, lampMap: THREE.Texture | null, signMap: THREE.Texture | null, rect: THREE.Vector4, time: { value: number }, steps = 12, halfRes = true) {
    const march = halfRes ? new HazeMarchPass(camera, { lampMap, signMap, rect, time, steps }) : null;
    const full = /* glsl */ `
      ${MARCH_UNIFORMS}
      uniform float uGain;
      uniform float uAbsorb;
      ${MARCH_FN(steps)}
      float hHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec4 h = marchHaze(uv, depth, hHash(uv * 1024.0));
        // Distance loses a little contrast and gains cool in-scatter. Keep most of the scene fog.
        outputColor = vec4(inputColor.rgb * mix(1.0, h.a, uAbsorb) + h.rgb * uGain, inputColor.a);
      }`;
    const half = /* glsl */ `
      uniform sampler2D tHaze;
      uniform float uGain;
      uniform float uAbsorb;
      ${VIEW_Z}
      float zAt(ivec2 lo, ivec2 full) { return linZ(texelFetch(depthBuffer, min(lo * 2, full - 1), 0).r); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        ivec2 full = textureSize(depthBuffer, 0);
        ivec2 mx = textureSize(tHaze, 0) - 1;
        float z = linZ(depth);
        // Half-res sample k covers full-res pixels 2k, 2k+1; its centre sits at full-res 2k + 0.5.
        vec2 hpos = (gl_FragCoord.xy - 0.5) * 0.5;
        vec2 b = floor(hpos);
        vec2 f = hpos - b;
        ivec2 bi = ivec2(b);
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int k = 0; k < 4; k++) {
          ivec2 o = ivec2(k & 1, k >> 1);
          ivec2 q = clamp(bi + o, ivec2(0), mx);
          float bw = mix(1.0 - f.x, f.x, float(o.x)) * mix(1.0 - f.y, f.y, float(o.y));
          float w = (bw + 0.02) / (0.02 + abs(zAt(q, full) - z) / z);
          acc += texelFetch(tHaze, q, 0) * w;
          ws += w;
        }
        vec4 h = acc / ws;
        outputColor = vec4(inputColor.rgb * mix(1.0, h.a, uAbsorb) + h.rgb * uGain, inputColor.a);
      }`;
    const uniforms = new Map<string, THREE.Uniform>([
      ['uGain', new THREE.Uniform(1.02)],
      ['uAbsorb', new THREE.Uniform(0.04)],
    ]);
    if (march) {
      uniforms.set('tHaze', new THREE.Uniform(march.rtHaze.texture));
      uniforms.set('uNear', new THREE.Uniform(camera.near));
      uniforms.set('uFar', new THREE.Uniform(camera.far));
    } else {
      uniforms.set('uProjInv', new THREE.Uniform(new THREE.Matrix4()));
      uniforms.set('uCamWorld', new THREE.Uniform(new THREE.Matrix4()));
      uniforms.set('uCamPos', new THREE.Uniform(new THREE.Vector3()));
      uniforms.set('uLampMap', new THREE.Uniform(lampMap));
      uniforms.set('uSignMap', new THREE.Uniform(signMap));
      uniforms.set('uRect', new THREE.Uniform(rect));
      uniforms.set('uDensity', new THREE.Uniform(0.0016));
      uniforms.set('uTime', time as THREE.Uniform);
    }
    super('CityHazeEffect', march ? half : full, { attributes: EffectAttribute.DEPTH, uniforms });
    this.march = march;
  }

  get gain() {
    return this.uniforms.get('uGain')!;
  }

  update() {
    const cam = this.camera;
    if (this.march) {
      this.uniforms.get('uNear')!.value = cam.near;
      this.uniforms.get('uFar')!.value = cam.far;
      return;
    }
    cam.updateMatrixWorld();
    this.uniforms.get('uProjInv')!.value.copy(cam.projectionMatrixInverse);
    this.uniforms.get('uCamWorld')!.value.copy(cam.matrixWorld);
    this.uniforms.get('uCamPos')!.value.setFromMatrixPosition(cam.matrixWorld);
  }
}
