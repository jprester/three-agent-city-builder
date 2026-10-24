import * as THREE from 'three';
import {
  BloomEffect, ChromaticAberrationEffect, Effect, EffectComposer, EffectPass, NoiseEffect, BlendFunction,
  RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import palette from '../../art/style/palette.json';
import type { QualityPreset } from '../systems/quality';

/** Live settings of the final grade, exposed for `?debug=1`. */
export interface GradeSettings {
  exposure: number;
  saturation: number;
  contrast: number;
  highlightDesat: number;
  lift: number;
}

/**
 * Final filmic grade, applied after AgX tone mapping and inside the same EffectPass (so it
 * costs no extra shader program). It cools the shadows, warms the highlights, pulls a little
 * saturation out of the midtones and the most saturated highlights, and adds a small black
 * lift instead of crushing the foreground. The reference frames are quieter and less
 * electric than the raw render; this is the smallest grade that gets there.
 */
const DEFAULT_GRADE: GradeSettings = {
  exposure: 1.1,
  saturation: 0.9,
  contrast: 1.0,
  highlightDesat: 0.14,
  lift: 0.01,
};

class NightGradeEffect extends Effect {
  readonly settings: GradeSettings;
  private readonly uExposure: THREE.Uniform;
  private readonly uSaturation: THREE.Uniform;
  private readonly uContrast: THREE.Uniform;
  private readonly uHighlightDesat: THREE.Uniform;
  private readonly uLift: THREE.Uniform;

  constructor() {
    const settings = { ...DEFAULT_GRADE };
    const uniforms = {
      uExposure: new THREE.Uniform(settings.exposure),
      uSaturation: new THREE.Uniform(settings.saturation),
      uContrast: new THREE.Uniform(settings.contrast),
      uHighlightDesat: new THREE.Uniform(settings.highlightDesat),
      uLift: new THREE.Uniform(settings.lift),
      uShadowTint: new THREE.Uniform(new THREE.Color(1, 1, 1).lerp(new THREE.Color(palette.tv_blue), 0.1)),
      uHighTint: new THREE.Uniform(new THREE.Color(1, 1, 1).lerp(new THREE.Color(palette.tungsten), 0.14)),
    };
    super('NightGradeEffect', /* glsl */ `
      uniform float uExposure, uSaturation, uContrast, uHighlightDesat, uLift;
      uniform vec3 uShadowTint, uHighTint;
      // Grade in display space, not linear: a contrast pivot at 0.18 linear would crush
      // every shadow below middle grey to black. The final pass encodes linear to sRGB.
      vec3 toSRGB(vec3 c) {
        return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, lessThanEqual(c, vec3(0.0031308)));
      }
      vec3 toLinear(vec3 c) {
        return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, lessThanEqual(c, vec3(0.04045)));
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = toSRGB(max(inputColor.rgb * uExposure, 0.0));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float shadow = 1.0 - smoothstep(0.0, 0.35, l);
        float high = smoothstep(0.45, 0.95, l);
        c *= mix(vec3(1.0), uShadowTint, shadow * 0.55);
        c *= mix(vec3(1.0), uHighTint, high * 0.55);
        float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float sat = uSaturation * (1.0 - uHighlightDesat * smoothstep(0.5, 1.0, l2));
        c = mix(vec3(l2), c, sat);
        c = (c - 0.5) * uContrast + 0.5;
        c += uLift * (1.0 - smoothstep(0.0, 0.5, l2));
        outputColor = vec4(toLinear(clamp(c, 0.0, 1.0)), inputColor.a);
      }`, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uExposure', uniforms.uExposure],
        ['uSaturation', uniforms.uSaturation],
        ['uContrast', uniforms.uContrast],
        ['uHighlightDesat', uniforms.uHighlightDesat],
        ['uLift', uniforms.uLift],
        ['uShadowTint', uniforms.uShadowTint],
        ['uHighTint', uniforms.uHighTint],
      ]),
    });
    this.settings = settings;
    this.uExposure = uniforms.uExposure;
    this.uSaturation = uniforms.uSaturation;
    this.uContrast = uniforms.uContrast;
    this.uHighlightDesat = uniforms.uHighlightDesat;
    this.uLift = uniforms.uLift;
  }

  /** Push the live settings into the shader uniforms (called by the debug panel). */
  apply() {
    this.uExposure.value = this.settings.exposure;
    this.uSaturation.value = this.settings.saturation;
    this.uContrast.value = this.settings.contrast;
    this.uHighlightDesat.value = this.settings.highlightDesat;
    this.uLift.value = this.settings.lift;
  }
}

export interface Post {
  composer: EffectComposer;
  bloom: BloomEffect;
  toneMapping: ToneMappingEffect;
  grade: NightGradeEffect;
  /** Resolves when every effect's assets (SMAA lookup textures) are loaded. */
  ready: Promise<void>;
}

/**
 * Bloom (mipmap blur; threshold set so only emissives bloom), AgX tone mapping, a subtle
 * vignette, grain and chromatic aberration, then SMAA on the tone-mapped image (unless the
 * quality preset turns it off).
 * Half-float buffers throughout. Only one convolution effect per pass, hence three passes.
 */
export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: QualityPreset, haze?: Effect): Post {
  renderer.toneMapping = THREE.NoToneMapping;
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  // Scattered city light first, in HDR, so bloom picks it up.
  if (haze) composer.addPass(new EffectPass(camera, haze));

  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 1.0,
    luminanceSmoothing: 0.32,
    intensity: 0.85,
    radius: 0.62,
    levels: quality.bloomLevels,
  });
  composer.addPass(new EffectPass(camera, bloom));

  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const grade = new NightGradeEffect();
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  grain.blendMode.opacity.value = 0.06;
  const aberration = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0004), radialModulation: true, modulationOffset: 0.35 });
  composer.addPass(new EffectPass(camera, toneMapping, grade, vignette, grain, aberration));

  let ready = Promise.resolve();
  if (quality.smaa) {
    const smaa = new SMAAEffect();
    composer.addPass(new EffectPass(camera, smaa));
    // SMAA decodes its lookup textures asynchronously and fires "load" (untyped in its d.ts).
    ready = new Promise<void>((resolve) => (smaa as unknown as THREE.EventDispatcher<{ load: object }>).addEventListener('load', () => resolve()));
  }
  return { composer, bloom, toneMapping, grade, ready };
}
