import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Boxes, Signs, assemble, buildShell } from './build';
import { createBoxMaterial, createFacadeMaterial } from './facade';
import { createGroundMaterial } from './ground';
import { createFixtureMap, createLampMap, createSignMap, mapRect } from './lightmaps';
import { createPlan } from './plan';
import { createPost } from './post';
import { createRain } from './rain';
import { PlanarReflection } from './reflection';
import { createSignMaterial, loadSignAtlas } from './signs';
import { createSky } from './sky';
import { createTraffic } from './traffic';
import { createTrains } from './train';
import { FOG_DENSITY, P, fog, heightFog, paletteColor, positionWorld, uniform } from './tsl';

/**
 * A fresh vertical slice of the night city, built in the order the retrospective recommends
 * (next/README.md): streets and vertical layers first, one facade material with distance tiers,
 * no light objects for the practical lights, signage as a system, and motion from day one.
 * WebGPU with node materials throughout; traffic and rain are compute passes.
 *
 * URL: ?view=corner|under|line|platform|deck|above|skyline, ?t=<seconds> freezes the clock, ?seed=<int>,
 * ?rain=<count> (0 = off).
 */
const VIEWS: Record<string, { position: [number, number, number]; target: [number, number, number] }> = {
  corner: { position: [-58, 1.7, -8.8], target: [30, 8.5, -1] },
  under: { position: [-33, 1.7, 10.4], target: [20, 6, -4] },
  platform: { position: [-30, 9.75, 6.4], target: [30, 9.3, -1] },
  line: { position: [-92, 4.2, -7.5], target: [-20, 10.5, 1] },
  deck: { position: [30.5, 7.3, 12.1], target: [-30, 8, 2] },
  above: { position: [-150, 105, 150], target: [-10, 6, -4] },
  skyline: { position: [-640, 330, 560], target: [0, 60, 0] },
};
const READY_FRAME = 3;

declare global {
  interface Window {
    /** Scene statistics of the ready frame, read by next/tests. */
    __SLICE?: { calls: number; triangles: number; reflection: { calls: number; triangles: number }; cars: number; boxes: number; signs: number; buildings: number };
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  const view = VIEWS[params.get('view') ?? 'corner'] ?? VIEWS.corner;
  const frozen = params.has('t') ? Number.parseFloat(params.get('t')!) : null;
  const plan = createPlan(Number.parseInt(params.get('seed') ?? '7', 10) || 7);

  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 4000);
  camera.position.set(...view.position);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...view.target);
  controls.enableDamping = !params.has('view');
  controls.update();

  const uTime = uniform(frozen ?? 0), uRain = uniform(1), uFog = uniform(FOG_DENSITY);
  const scene = new THREE.Scene();
  scene.background = paletteColor('sky');
  scene.fogNode = fog(P('haze'), heightFog(positionWorld, uFog));
  const sky = createSky(uTime, [[0, 0, 1], [-140, -120, 0.6], [150, 120, 0.6]]);
  scene.add(sky.mesh);
  // Sky fill only: a hemisphere and one broad directional so forms read. Every practical light
  // (lamps, signs, windows, vehicles) is emission plus the top-down light maps.
  const cool = paletteColor('tv_blue').lerp(paletteColor('fluorescent'), 0.45);
  scene.add(new THREE.HemisphereLight(cool, paletteColor('sodium').multiplyScalar(0.035), 0.11));
  const skyLight = new THREE.DirectionalLight(cool, 0.26);
  skyLight.position.set(-180, 260, -90);
  scene.add(skyLight);

  // Plan → instance data. Signs come first: their glow map lights everything else.
  const boxes = new Boxes(), signs = new Signs();
  const roofs = assemble(plan, boxes, signs);
  const rect = mapRect(plan), uRect = uniform(rect);
  const lampMap = createLampMap(plan, rect), signMap = createSignMap(signs.lights, rect);
  const fixtures = createFixtureMap(boxes.fixtures, rect);
  const fixtureMap = fixtures.texture, fixtureHeights = uniform(fixtures.heights);
  const lit = { time: uTime, lampMap, signMap, fixtureMap, fixtureHeights, lampRect: uRect };

  const buildings = new THREE.Mesh(buildShell([...plan.buildings, ...plan.skyline]), createFacadeMaterial(lit));
  buildings.name = 'buildings';
  buildings.frustumCulled = false;
  const boxMaterial = createBoxMaterial(lit);
  const kit = boxes.build(boxMaterial);
  const signMesh = signs.build(createSignMaterial(await loadSignAtlas(), uTime));
  const trains = createTrains(plan, boxMaterial);
  const traffic = createTraffic(plan, lampMap, uRect);
  scene.add(buildings, kit, signMesh, trains.group, traffic.cars);

  const reflection = new PlanarReflection(0.25);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2),
    createGroundMaterial({ color: 'road_wet', roughness: 0.35 }, { time: uTime, rain: uRain, lampMap, signMap, fixtureMap, fixtureHeights, lampRect: uRect, reflection: reflection.target.texture, reflMatrix: reflection.matrix }),
  );
  ground.name = 'ground';
  scene.add(ground, traffic.pools);
  const rainCount = Number.parseInt(params.get('rain') ?? '30000', 10);
  const rain = rainCount > 0 ? createRain(roofs, { count: rainCount, lampMap, signMap, lampRect: uRect, rect, eye: camera.position }) : null;
  if (rain) scene.add(rain.mesh);
  const unreflected: THREE.Object3D[] = [ground, traffic.pools, ...(rain ? [rain.mesh] : [])];

  const post = createPost(renderer, scene, camera, { lampMap, signMap, lampRect: uRect, time: uTime, density: uFog });
  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    reflection.setSize(size.x, size.y);
  };
  window.addEventListener('resize', resize);
  resize();

  const start = performance.now();
  let last = frozen ?? 0, frames = 0;
  renderer.setAnimationLoop(() => {
    const now = frozen ?? (performance.now() - start) / 1000;
    const dt = now - last;
    last = now;
    controls.update();
    uTime.value = now;
    // Rain comes in slow waves; the fog breathes a little.
    const wave = 0.5 + 0.5 * Math.cos((2 * Math.PI * now) / 180);
    uRain.value = 0.35 + 0.65 * wave * wave * (3 - 2 * wave);
    uFog.value = FOG_DENSITY * (1 + 0.18 * Math.sin((2 * Math.PI * now) / 240));
    trains.update(now);
    traffic.update(renderer, dt, now);
    rain?.update(renderer, camera, dt, uRain.value);

    renderer.info.reset();
    reflection.update(renderer, scene, camera, unreflected);
    const reflCalls = renderer.info.render.drawCalls, reflTris = renderer.info.render.triangles;
    post.update();
    post.pipeline.render();
    if (++frames === READY_FRAME) {
      window.__SLICE = {
        calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles,
        reflection: { calls: reflCalls, triangles: reflTris },
        cars: traffic.count, boxes: boxes.count, signs: signs.lights.length, buildings: plan.buildings.length + plan.skyline.length,
      };
      window.__READY = true;
    }
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('status');
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  window.__READY = true;
});
