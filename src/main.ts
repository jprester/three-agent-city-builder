import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AssetLoader, hasAnyAssets, layoutUrl } from './assets/registry';
import { applyViewpoint } from './debug/viewpoints';
import { createGround, createRenderer, createScene } from './scene/environment';
import { buildInstances } from './systems/instancing';
import { fetchLayout, generateLayout, type Layout } from './systems/layout';
import { setStatus } from './ui/status';

declare global {
  interface Window {
    /** Set once the scene is fully loaded and rendered; Playwright waits on it. */
    __READY?: boolean;
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  const layoutId = params.get('layout') ?? 'district_a';
  const viewpoint = params.get('viewpoint') ?? 'overview';

  const renderer = createRenderer();
  const scene = createScene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !params.has('viewpoint');
  applyViewpoint(viewpoint, camera, controls);

  let layout: Layout | null = null;
  const url = layoutUrl(layoutId);
  const seedParam = params.get('seed');
  const seed = seedParam === null ? null : Number.parseInt(seedParam, 10);
  if (!hasAnyAssets()) {
    setStatus('No assets built yet. Run `npm run assets`, then reload.');
  } else if (seed !== null && Number.isNaN(seed)) {
    setStatus(`?seed= must be an integer, got "${seedParam}".`);
  } else if (seed === null && !url) {
    setStatus(`Layout "${layoutId}" not found. Check public/layouts/ or run \`npm run assets\`.`);
  } else {
    // ?seed= regenerates the layout in the browser; otherwise load the prebuilt JSON.
    layout = seed !== null ? await generateLayout(layoutId, seed) : await fetchLayout(url!);
    const { group, missing } = await buildInstances(layout, new AssetLoader());
    scene.add(group);
    if (missing.length) setStatus(`Layout references unbuilt assets: ${missing.join(', ')}`);
  }
  scene.add(createGround(layout));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let frames = 0;
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    if (++frames === 3) window.__READY = true;
  });
}

main().catch((err) => {
  console.error(err);
  setStatus(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  window.__READY = true;
});
