import * as THREE from 'three';
import {
  BloomEffect, ChromaticAberrationEffect, type Effect, EffectComposer, EffectPass, NoiseEffect, BlendFunction,
  RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import type { QualityPreset } from '../systems/quality';

export interface Post {
  composer: EffectComposer;
  bloom: BloomEffect;
  toneMapping: ToneMappingEffect;
  /** Resolves when every effect's assets (SMAA lookup textures) are loaded. */
  ready: Promise<void>;
}

/**
 * Bloom (mipmap blur; threshold set so only emissives bloom), AgX tone mapping, a subtle
 * vignette, grain and chromatic aberration, then SMAA on the tone-mapped image.
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
    luminanceThreshold: 0.9,
    luminanceSmoothing: 0.35,
    intensity: 1.1,
    radius: 0.72,
    levels: quality.bloomLevels,
  });
  composer.addPass(new EffectPass(camera, bloom));

  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  grain.blendMode.opacity.value = 0.06;
  const aberration = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0004), radialModulation: true, modulationOffset: 0.35 });
  composer.addPass(new EffectPass(camera, toneMapping, vignette, grain, aberration));

  const smaa = new SMAAEffect();
  composer.addPass(new EffectPass(camera, smaa));
  // SMAA decodes its lookup textures asynchronously and fires "load" (untyped in its d.ts).
  const ready = new Promise<void>((resolve) => (smaa as unknown as THREE.EventDispatcher<{ load: object }>).addEventListener('load', () => resolve()));
  return { composer, bloom, toneMapping, ready };
}
