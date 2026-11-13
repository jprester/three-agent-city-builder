import * as THREE from 'three/webgpu';
import { fog, positionWorld, uniform } from './tsl';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AssetLoader, hasAnyAssets, layoutUrl } from '../assets/registry';
import { applyViewpoint } from '../debug/viewpoints';
import type { SceneStats } from '../main';
import { CAR_LIGHTS } from '../materials/ground';
import { createBridges } from '../scene/bridges';
import { FOG_DENSITY } from '../scene/environment';
import { createLampMap, createSignLightMap } from '../scene/lampmap';
import { lightningAt } from '../scene/lightning';
import { nightAt } from '../scene/night';
import { isGradeName } from '../scene/post';
import { loadSignArt } from '../scene/signs/art';
import { loadSignAtlas } from '../scene/signs/atlas';
import { createSigns } from '../scene/signs/signs';
import { createStreets } from '../scene/streets';
import { CameraRig, isCameraMode, obstaclesFrom } from '../systems/cameras';
import { Clock, parseFrozenTime } from '../systems/clock';
import { FlythroughPath } from '../systems/flythrough';
import { buildInstances } from '../systems/instancing';
import { fetchLayout, generateLayout, type Layout } from '../systems/layout';
import { isQualityName, QUALITY_PRESETS } from '../systems/quality';
import { createWalkSurface } from '../systems/walk';
import { createHud } from '../ui/hud';
import { setStatus } from '../ui/status';
import { createFacadeMaterial } from './facade';
import { GROUND_VARIANTS, createGroundMaterial } from './ground';
import { createPost } from './post';
import { createRain } from './rain';
import { PlanarReflection } from './reflection';
import { createHoloMaterial, createSignMaterial } from './signs';
import { createSky } from './sky';
import { loadFacadeTextures } from './textures';
import { P, heightFog, paletteColor } from './tsl';

/**
 * WebGPU proof of concept: the same layout, assets, LOD, cameras and sign data as src/main.ts,
 * drawn by three's WebGPURenderer with node materials (src/poc/*). Open /poc.html; the URL
 * parameters of the main app apply (`?viewpoint=`, `?quality=`, `?grade=`, `?t=`, `?seed=`),
 * plus `?backend=webgl` to run the same node materials on the WebGL 2 fallback.
 * See docs/WEBGPU_POC.md for what is ported, what is reduced and what is missing.
 */
const READY_FRAME = 3;
const REFLECTION_LOD_BIAS = 0.25;

declare global {
  interface Window {
    __BACKEND?: string;
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  const layoutId = params.get('layout') ?? 'city';
  const cameraParam = params.get('camera') ?? 'orbit';
  const viewpoint = params.get('viewpoint') ?? (cameraParam === 'walk' ? 'canyon' : 'aerial');
  const problems: string[] = [];
  const qualityParam = params.get('quality') ?? 'high';
  const quality = QUALITY_PRESETS[isQualityName(qualityParam) ? qualityParam : 'high'];
  const gradeParam = params.get('grade') ?? 'filmic';
  const grade = isGradeName(gradeParam) ? gradeParam : 'filmic';
  let frozenAt = parseFrozenTime(params.get('t'));
  if (Number.isNaN(frozenAt)) frozenAt = null;
  const clock = new Clock(frozenAt);

  // No GPU timestamp queries: on this machine (Apple GPU) the per-pass times three resolves add
  // up to several times the real frame. tests/perf measures submit-to-done from outside instead.
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance', forceWebGL: params.get('backend') === 'webgl' });
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  window.__BACKEND = backend;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !params.has('viewpoint');

  let layout: Layout | null = null;
  const url = layoutUrl(layoutId);
  const seedParam = params.get('seed');
  const seed = seedParam === null ? null : Number.parseInt(seedParam, 10);
  if (!hasAnyAssets()) problems.push('No assets built yet. Run `npm run assets`, then reload.');
  else if (seed !== null && Number.isNaN(seed)) problems.push(`?seed= must be an integer, got "${seedParam}".`);
  else if (seed === null && !url) problems.push(`Layout "${layoutId}" not found.`);
  else layout = seed !== null ? await generateLayout(layoutId, seed) : await fetchLayout(url!);
  if (!layout) {
    setStatus(problems.join(' '));
    window.__READY = true;
    return;
  }

  // Shared shader inputs: one clock, night state, fog density, the two top-down light maps.
  const uTime = uniform(clock.time), uNight = uniform(0), uRain = uniform(1), uFogDensity = uniform(FOG_DENSITY);
  const scene = new THREE.Scene();
  scene.background = paletteColor('sky');
  scene.fogNode = fog(P('haze'), heightFog(positionWorld, uFogDensity));
  const sky = createSky(uTime, layout);
  scene.add(sky.mesh);
  const cool = paletteColor('tv_blue').lerp(paletteColor('fluorescent'), 0.45);
  const hemi = new THREE.HemisphereLight(cool, paletteColor('sodium').multiplyScalar(0.035), 0.11);
  const skyLight = new THREE.DirectionalLight(paletteColor('tv_blue').lerp(paletteColor('fluorescent'), 0.4), 0.26);
  skyLight.position.set(-180, 260, -90);
  scene.add(hemi, skyLight);

  const lamps = createLampMap(layout);
  const uLampRect = uniform(lamps.rect);
  const anisotropy = Math.min(8, renderer.getMaxAnisotropy());
  const [facadeTextures, signArt, atlas] = await Promise.all([loadFacadeTextures(anisotropy), loadSignArt(anisotropy), loadSignAtlas()]);

  // Signs first: their light map feeds the facades, the ground and the haze. createSigns
  // builds the instance data; its WebGL materials are replaced by the node versions.
  const unreflected: THREE.Object3D[] = [];
  const legacyUniforms = {
    uTime: clock.uniform, uAtlas: { value: atlas.texture }, uSignGain: { value: 1 },
    uNeonV: { value: signArt.atlases[0] }, uNeonH: { value: signArt.atlases[1] }, uPosterP: { value: signArt.atlases[2] }, uPosterL: { value: signArt.atlases[3] },
  };
  const signs = createSigns(layout, atlas, signArt, legacyUniforms);
  const signMap = createSignLightMap(layout, signs?.lights ?? []);
  if (signs) {
    swapMaterial(signs.mesh, createSignMaterial(atlas.texture, signArt, uTime));
    scene.add(signs.mesh);
    if (signs.brackets) {
      scene.add(signs.brackets);
      if (!quality.reflectBuildings) unreflected.push(signs.brackets);
    }
    if (signs.holo) {
      swapMaterial(signs.holo, createHoloMaterial(atlas.texture, signArt, uTime, uFogDensity));
      scene.add(signs.holo);
    }
  }

  const facadeMaterial = createFacadeMaterial({
    time: uTime, night: uNight, seed: layout.seed, lampMap: lamps.texture, lampRect: uLampRect, signMap,
    towerDiffuse: facadeTextures.diffuse, towerEmissive: facadeTextures.emissive, walls: facadeTextures.walls, interiors: facadeTextures.interiors, screens: signArt.screens,
  });
  const { group, missing, lod: facadeLod, vehicles } = await buildInstances(layout, new AssetLoader(), facadeMaterial, quality.vehicleDensity);
  vehicles?.update(clock.time);
  scene.add(group);
  if (missing.length) problems.push(`Layout references unbuilt assets: ${missing.join(', ')}`);
  // The facade material reads the instance matrix, so the merged bridges become one instance.
  const bridgeMesh = createBridges(layout, facadeMaterial);
  const bridges = bridgeMesh ? new THREE.InstancedMesh(bridgeMesh.geometry, facadeMaterial, 1) : null;
  if (bridges) {
    bridges.setMatrixAt(0, new THREE.Matrix4());
    bridges.name = 'bridges';
    scene.add(bridges);
  }
  if (!quality.reflectBuildings) unreflected.push(group, ...(bridges ? [bridges] : []));

  const reflection = new PlanarReflection(quality.reflectionScale);
  const cars = Array.from({ length: CAR_LIGHTS }, () => new THREE.Vector4());
  const groundShared = {
    time: uTime, rain: uRain, lampMap: lamps.texture, signMap, lampRect: uLampRect,
    reflection: reflection.target.texture, reflMatrix: reflection.matrix, cars,
  };
  // createStreets builds the meshes; each gets its node-material variant by name.
  const streets = createStreets(layout, {
    uLampMap: { value: null }, uLampRect: { value: lamps.rect }, uReflection: { value: null }, uReflMatrix: { value: reflection.matrix },
    uWet: { value: 1 }, uSignMap: { value: null }, uTime: clock.uniform, uCars: { value: cars }, uRain: { value: 1 },
  });
  const groundMaterials = new Map<string, THREE.Material>();
  for (const child of streets.children as THREE.Mesh[]) {
    const variant = GROUND_VARIANTS[child.name];
    if (!variant) throw new Error(`No ground variant for mesh "${child.name}"`);
    const key = JSON.stringify(variant);
    if (!groundMaterials.has(key)) groundMaterials.set(key, createGroundMaterial(variant, groundShared));
    swapMaterial(child, groundMaterials.get(key)!);
  }
  scene.add(streets);
  unreflected.push(streets);

  const path = FlythroughPath.from(layout);
  if (!applyViewpoint(viewpoint, camera, controls, layout, path)) problems.push(`Unknown viewpoint "${viewpoint}".`);
  const hud = createHud(!params.has('viewpoint') && frozenAt === null);
  const rig = new CameraRig(clock, camera, renderer.domElement, controls, path, (mode) => hud.show(mode, !!path));
  rig.obstacles = obstaclesFrom([...layout.instances, ...(layout.fringe ?? []), ...(layout.parked ?? [])]);
  rig.walkSurface = createWalkSurface(layout);
  if (isCameraMode(cameraParam)) rig.setMode(cameraParam, true);
  setStatus(problems.join(' '));

  // Rain: a compute-shader particle system (src/poc/rain.ts). `?rain=<n>` scales the WebGL
  // preset's count (default 2: half of the drops spend part of their time as splashes or on roofs).
  const rainScale = Number.parseFloat(params.get('rain') ?? '2');
  const rain = !(rainScale > 0) ? null
    : createRain(layout, { count: Math.round(quality.rainCount * rainScale), lampMap: lamps.texture, signMap, lampRect: uLampRect, rect: lamps.rect, eye: camera.position });
  if (rain) {
    scene.add(rain.mesh);
    unreflected.push(rain.mesh);
  }

  const post = createPost(renderer, scene, camera, quality, grade,
    params.get('haze') === '0' ? null : { lampMap: lamps.texture, signMap, lampRect: uLampRect, time: uTime, density: uFogDensity });
  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    reflection.setSize(size.x, size.y);
  };
  window.addEventListener('resize', resize);
  resize();

  window.__PAUSE_RENDER = () => renderer.setAnimationLoop(null);
  let frames = 0;
  let lastReal = performance.now();
  let last = clock.time;
  renderer.setAnimationLoop(() => {
    const now = clock.tick();
    const delta = now - last;
    last = now;
    const real = performance.now();
    rig.update((real - lastReal) / 1000);
    lastReal = real;
    vehicles?.update(now);
    vehicles?.nearest(camera.position, cars);
    const n = nightAt(now);
    const { flash, dir } = lightningAt(now);
    uTime.value = now;
    uNight.value = n.night;
    uRain.value = n.rain;
    uFogDensity.value = FOG_DENSITY * n.fog;
    sky.flash.value = flash;
    sky.flashDir.value.set(dir[0], dir[1]);
    hemi.intensity = 0.11 + 0.5 * flash;
    skyLight.intensity = 0.26 + 1.6 * flash;

    rain?.update(renderer, camera, delta, n.rain);

    renderer.info.reset();
    // The reflection is quarter resolution and smeared: simplified buildings from 1/4 the distance.
    facadeLod?.update(camera, REFLECTION_LOD_BIAS * quality.lodDistanceScale, true);
    reflection.update(renderer, scene, camera, unreflected);
    const reflCalls = renderer.info.render.drawCalls, reflTris = renderer.info.render.triangles;
    facadeLod?.update(camera, quality.lodDistanceScale);
    post.update();
    post.pipeline.render();
    if (++frames === READY_FRAME) {
      const { info } = renderer;
      const stats: SceneStats = {
        calls: info.render.drawCalls,
        triangles: info.render.triangles,
        programs: (info.memory as { programs?: number }).programs ?? 0,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
        reflection: { calls: reflCalls, triangles: reflTris },
      };
      window.__STATS = stats;
      window.__READY = true;
    }
  });
}

/** Replace a mesh's WebGL material (built by the shared scene code) with its node version. */
function swapMaterial(mesh: THREE.Mesh, material: THREE.Material) {
  (mesh.material as THREE.Material).dispose();
  mesh.material = material;
}

main().catch((err) => {
  console.error(err);
  setStatus(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  window.__READY = true;
});
