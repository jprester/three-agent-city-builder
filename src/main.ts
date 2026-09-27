import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AssetLoader, hasAnyAssets, layoutUrl } from './assets/registry';
import { createDebugGui } from './debug/gui';
import { applyViewpoint } from './debug/viewpoints';
import { createFacadeMaterial, createFacadeUniforms } from './materials/facade';
import { loadFacadeTextures } from './materials/textures';
import { createGroundUniforms } from './materials/ground';
import { createRenderer, createScene } from './scene/environment';
import { captureCityEnvironment } from './scene/environment-map';
import { createLampMap, createSignLightMap } from './scene/lampmap';
import { CityHazeEffect } from './scene/haze';
import { createPost } from './scene/post';
import { PlanarReflection } from './scene/reflection';
import { createStreets } from './scene/streets';
import { createRain } from './scene/rain';
import { createBridges } from './scene/bridges';
import { createSignAtlas } from './scene/signs/atlas';
import { loadSignArt } from './scene/signs/art';
import { createSigns } from './scene/signs/signs';
import { Clock, parseFrozenTime } from './systems/clock';
import type { FacadeLod } from './systems/buildings';
import { buildInstances } from './systems/instancing';
import { fetchLayout, generateLayout, type Layout } from './systems/layout';
import { isQualityName, QUALITY_PRESETS } from './systems/quality';
import { setStatus } from './ui/status';

export interface SceneStats {
  calls: number;
  triangles: number;
  programs: number;
  textures: number;
  geometries: number;
}

declare global {
  interface Window {
    /** Set once the scene is fully loaded and rendered; Playwright waits on it. */
    __READY?: boolean;
    /** renderer.info for the ready frame (all passes); read by tests/visual/shots.spec.ts. */
    __STATS?: SceneStats;
    /** Test hook: hold the completed frame during slow software screenshot capture. */
    __PAUSE_RENDER?: () => void;
  }
}

/** Frames rendered before the scene counts as ready (lets async shader compiles settle). */
const READY_FRAME = 3;
/** LOD switch distances in the reflection pass, relative to the main view. */
const REFLECTION_LOD_BIAS = 0.25;

async function main() {
  const params = new URLSearchParams(location.search);
  const layoutId = params.get('layout') ?? 'city';
  const viewpoint = params.get('viewpoint') ?? 'aerial';
  const problems: string[] = [];

  const qualityParam = params.get('quality') ?? 'high';
  if (!isQualityName(qualityParam)) problems.push(`?quality= must be low, med or high, got "${qualityParam}"; using high.`);
  const quality = QUALITY_PRESETS[isQualityName(qualityParam) ? qualityParam : 'high'];

  let frozenAt = parseFrozenTime(params.get('t'));
  if (Number.isNaN(frozenAt)) {
    problems.push(`?t= must be a number of seconds, got "${params.get('t')}"; clock is running.`);
    frozenAt = null;
  }
  const clock = new Clock(frozenAt);

  const renderer = createRenderer(quality.pixelRatio);
  const scene = createScene(clock.uniform);
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !params.has('viewpoint');

  let layout: Layout | null = null;
  let facadeLod: FacadeLod | null = null;
  let vehicles: { update(time: number): void } | null = null;
  const url = layoutUrl(layoutId);
  const seedParam = params.get('seed');
  const seed = seedParam === null ? null : Number.parseInt(seedParam, 10);
  if (!hasAnyAssets()) {
    problems.push('No assets built yet. Run `npm run assets`, then reload.');
  } else if (seed !== null && Number.isNaN(seed)) {
    problems.push(`?seed= must be an integer, got "${seedParam}".`);
  } else if (seed === null && !url) {
    problems.push(`Layout "${layoutId}" not found. Check public/layouts/ or run \`npm run assets\`.`);
  } else {
    // ?seed= regenerates the layout in the browser; otherwise load the prebuilt JSON.
    layout = seed !== null ? await generateLayout(layoutId, seed) : await fetchLayout(url!);
  }

  // Shared inputs of the city's shaders: one clock, one seed, one street-light map.
  const lamps = layout ? createLampMap(layout) : null;
  const facadeTextures = await loadFacadeTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const facadeUniforms = createFacadeUniforms(clock.uniform, layout?.seed ?? 0, facadeTextures);
  const groundUniforms = createGroundUniforms(facadeUniforms.uLampRect);
  groundUniforms.uTime = clock.uniform;
  const reflection = new PlanarReflection(quality.reflectionScale);
  groundUniforms.uReflection.value = reflection.target.texture;
  groundUniforms.uReflMatrix.value = reflection.matrix;
  if (lamps) {
    facadeUniforms.uLampMap.value = lamps.texture;
    facadeUniforms.uLampRect.value.copy(lamps.rect);
    groundUniforms.uLampMap.value = lamps.texture;
  }
  if (layout) {
    const facadeMaterial = createFacadeMaterial(facadeUniforms);
    const { group, missing, lod, vehicles: motion } = await buildInstances(layout, new AssetLoader(), facadeMaterial, quality.vehicleDensity);
    facadeLod = lod;
    vehicles = motion;
    vehicles?.update(clock.time);
    scene.add(group);
    const bridges = createBridges(layout, facadeMaterial);
    if (bridges) scene.add(bridges);
    if (missing.length) problems.push(`Layout references unbuilt assets: ${missing.join(', ')}`);
  }
  let signMap: THREE.Texture | null = null;
  const signArt = await loadSignArt(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  facadeUniforms.uScreens.value = signArt.textures.posterP;
  const signUniforms = {
    uTime: clock.uniform, uAtlas: { value: null as THREE.Texture | null }, uSignGain: { value: 1 },
    uNeonV: { value: signArt.textures.neonV }, uNeonH: { value: signArt.textures.neonH },
    uPosterP: { value: signArt.textures.posterP }, uPosterL: { value: signArt.textures.posterL },
  };
  if (layout) {
    const atlas = createSignAtlas(layout.seed);
    signUniforms.uAtlas.value = atlas.texture;
    const signs = createSigns(layout, atlas, signArt, signUniforms);
    if (signs) {
      scene.add(signs.mesh);
      if (signs.brackets) scene.add(signs.brackets);
      signMap = createSignLightMap(layout, signs.lights);
      facadeUniforms.uSignMap.value = signMap;
      groundUniforms.uSignMap.value = signMap;
    }
  }
  const streets = createStreets(layout, groundUniforms);
  scene.add(streets);
  const rain = lamps && params.get('rain') !== '0'
    ? createRain({ count: quality.rainCount, time: clock.uniform, lampMap: lamps.texture, signMap, lampRect: lamps.rect })
    : null;
  if (rain) scene.add(rain);
  if (!applyViewpoint(viewpoint, camera, controls, layout)) problems.push(`Unknown viewpoint "${viewpoint}".`);
  setStatus(problems.join(' '));

  // Capture before adding the reflective ground, whose target is not rendered yet.
  streets.visible = false;
  captureCityEnvironment(renderer, scene, layout);
  streets.visible = true;

  const haze = lamps ? new CityHazeEffect(camera, lamps.texture, signMap, lamps.rect, clock.uniform) : undefined;
  const post = createPost(renderer, scene, camera, quality, haze);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  reflection.setSize(size.x, size.y);
  await post.ready;
  const debug = params.get('debug') === '1' ? await createDebugGui(renderer, scene, clock, { post, facade: facadeUniforms, ground: groundUniforms }) : null;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.composer.setSize(window.innerWidth, window.innerHeight);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    reflection.setSize(size.x, size.y);
  });

  window.__PAUSE_RENDER = () => renderer.setAnimationLoop(null);
  let frames = 0;
  let last = clock.time;
  renderer.setAnimationLoop(() => {
    const now = clock.tick();
    const delta = now - last;
    last = now;
    controls.update();
    vehicles?.update(now);
    renderer.info.reset();
    // The reflection is half resolution and smeared: simplified buildings from 1/4 the distance.
    facadeLod?.update(camera, REFLECTION_LOD_BIAS);
    reflection.update(renderer, scene, camera, rain ? [streets, rain] : [streets]);
    facadeLod?.update(camera);
    post.composer.render(delta);
    debug?.update();
    if (++frames === READY_FRAME) {
      const { info } = renderer;
      window.__STATS = {
        calls: info.render.calls,
        triangles: info.render.triangles,
        programs: info.programs?.length ?? 0,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
      };
      window.__READY = true;
    }
  });
}

main().catch((err) => {
  console.error(err);
  setStatus(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  window.__READY = true;
});
