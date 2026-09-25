import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AssetLoader, hasAnyAssets, layoutUrl } from './assets/registry';
import { createDebugGui } from './debug/gui';
import { applyViewpoint } from './debug/viewpoints';
import { createFacadeMaterial, createFacadeUniforms } from './materials/facade';
import { loadFacadeTextures } from './materials/textures';
import { createGroundUniforms } from './materials/ground';
import { createRenderer, createScene } from './scene/environment';
import { createLampMap, createSignLightMap } from './scene/lampmap';
import { CityHazeEffect } from './scene/haze';
import { createPost } from './scene/post';
import { PlanarReflection } from './scene/reflection';
import { createStreets } from './scene/streets';
import { createSignAtlas } from './scene/signs/atlas';
import { createSigns } from './scene/signs/signs';
import { Clock, parseFrozenTime } from './systems/clock';
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
  }
}

/** Frames rendered before the scene counts as ready (lets async shader compiles settle). */
const READY_FRAME = 3;

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
  const scene = createScene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !params.has('viewpoint');

  let layout: Layout | null = null;
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
  const reflection = new PlanarReflection(quality.reflectionScale);
  groundUniforms.uReflection.value = reflection.target.texture;
  groundUniforms.uReflMatrix.value = reflection.matrix;
  if (lamps) {
    facadeUniforms.uLampMap.value = lamps.texture;
    facadeUniforms.uLampRect.value.copy(lamps.rect);
    groundUniforms.uLampMap.value = lamps.texture;
  }
  if (layout) {
    const { group, missing } = await buildInstances(layout, new AssetLoader(), createFacadeMaterial(facadeUniforms));
    scene.add(group);
    if (missing.length) problems.push(`Layout references unbuilt assets: ${missing.join(', ')}`);
  }
  let signMap: THREE.Texture | null = null;
  const signUniforms = { uTime: clock.uniform, uAtlas: { value: null as THREE.Texture | null }, uSignGain: { value: 1 } };
  if (layout) {
    const atlas = createSignAtlas(layout.seed);
    signUniforms.uAtlas.value = atlas.texture;
    const signs = createSigns(layout, atlas, signUniforms);
    if (signs) {
      scene.add(signs.mesh);
      signMap = createSignLightMap(layout, signs.lights);
      facadeUniforms.uSignMap.value = signMap;
      groundUniforms.uSignMap.value = signMap;
    }
  }
  const streets = createStreets(layout, groundUniforms);
  scene.add(streets);
  if (!applyViewpoint(viewpoint, camera, controls, layout)) problems.push(`Unknown viewpoint "${viewpoint}".`);
  setStatus(problems.join(' '));

  const haze = lamps ? new CityHazeEffect(camera, lamps.texture, signMap, lamps.rect) : undefined;
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

  let frames = 0;
  let last = clock.time;
  renderer.setAnimationLoop(() => {
    const now = clock.tick();
    const delta = now - last;
    last = now;
    controls.update();
    renderer.info.reset();
    reflection.update(renderer, scene, camera, [streets]);
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
