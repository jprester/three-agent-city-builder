import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AssetLoader, hasAnyAssets, layoutUrl } from './assets/registry';
import { createDebugGui } from './debug/gui';
import { applyViewpoint } from './debug/viewpoints';
import { createRenderer, createScene } from './scene/environment';
import { createStreets } from './scene/streets';
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
    /** renderer.info for the ready frame; read by tests/visual/shots.spec.ts. */
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
    const { group, missing } = await buildInstances(layout, new AssetLoader());
    scene.add(group);
    if (missing.length) problems.push(`Layout references unbuilt assets: ${missing.join(', ')}`);
  }
  scene.add(createStreets(layout));
  if (!applyViewpoint(viewpoint, camera, controls, layout)) problems.push(`Unknown viewpoint "${viewpoint}".`);
  setStatus(problems.join(' '));

  const debug = params.get('debug') === '1' ? await createDebugGui(renderer, scene, clock) : null;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let frames = 0;
  renderer.setAnimationLoop(() => {
    clock.tick();
    controls.update();
    renderer.render(scene, camera);
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
