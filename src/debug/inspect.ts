import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import palette from '../../art/style/palette.json';
import { AssetLoader, getAsset } from '../assets/registry';
import type { AssetMeta } from '../assets/types';
import { createFacadeMaterial, createFacadeUniforms } from '../materials/facade';
import { loadFacadeTextures, TOWER_BUNDLES } from '../materials/textures';
import { applyDaylight, isLightName } from '../scene/daylight';
import { createRenderer, createScene } from '../scene/environment';
import { captureCityEnvironment, captureGlassEnvironment } from '../scene/environment-map';
import { createPost } from '../scene/post';
import { buildFacadeBatch } from '../systems/buildings';
import { QUALITY_PRESETS } from '../systems/quality';
import { setStatus } from '../ui/status';

/**
 * Inspect one asset (`?inspect=<asset id>`): the city's own facade rendering for a single
 * building on a neutral ground, by day unless `light=night`. Everything the runtime varies by
 * chance can be pinned, so a defect can be reproduced on purpose:
 *   facade=<n>       tower facade n (0-27: osaka 0-6, real_glass 7-13, glass_sky 14-20, baked 21-27)
 *   scale=sx,sy,sz   the layout's instance scale (towers: 0.7-1.0 across, 0.6-1.35 up)
 *   view=<name>      a camera from inspectViews(); overlay=1 draws the shader's floor (red),
 *                    bay / cell (cyan) and module (yellow) lines
 *   sheet=1          a contact sheet instead: rows facades=<all | 0-6,9>, columns
 *                    views=<names | all>, tiles tile=<w>x<h>; window.__READY when drawn
 * Keys (interactive): [ ] facade, O overlay, V next view; the mouse orbits.
 */

export interface InspectView { name: string; position: THREE.Vector3; target: THREE.Vector3 }

const FACADE_NAMES = TOWER_BUNDLES.flatMap((_, b) => Array.from({ length: 7 }, (_, i) => `${['os', 're', 'gl', 'bk'][b]}${i}`));

/** Cameras from the asset's own data (building local frame, front at +Z, scaled). */
export function inspectViews(meta: AssetMeta, scale: [number, number, number]): InspectView[] {
  const [W, D] = meta.footprint ?? [20, 20];
  const H = meta.height ?? 20;
  const tan = Math.tan(THREE.MathUtils.degToRad(25));
  const fit = (Math.max(H, W) / 2 / tan) * 1.15;
  const views: InspectView[] = [];
  const v = (name: string, p: [number, number, number], t: [number, number, number]) => views.push({
    name,
    position: new THREE.Vector3(p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]),
    target: new THREE.Vector3(t[0] * scale[0], t[1] * scale[1], t[2] * scale[2]),
  });
  v('front', [0, H / 2, D / 2 + fit], [0, H / 2, 0]);
  v('corner', [(D / 2 + fit) * 0.7, H * 0.4, (D / 2 + fit) * 0.7], [0, H * 0.4, 0]);
  v('street', [W * 0.15, 1.7 / scale[1], D / 2 + 22], [0, Math.min(H, 40), D / 2]);
  // Close on a corner at mid-height of the first tier: where a bay is cut horizontally.
  const mid = tiers0(meta) ?? H * 0.3;
  v('edge', [W / 2 + 14, mid, D / 2 + 14], [W / 2 - 4, mid, D / 2 - 4]);
  // Close and square on the front: window-scale detail (emissive, frames, relief).
  v('close', [W * 0.1, mid, D / 2 + 12], [W * 0.1, mid + 1, D / 2]);
  // A level view at every band junction: where a cut row would show.
  const edges: { name: string; z: number; face: number }[] = [];
  if (typeof meta.podium === 'number') edges.push({ name: 'podium', z: meta.podium, face: D / 2 });
  if (typeof meta.base === 'number') edges.push({ name: 'base', z: meta.base, face: D / 2 });
  const tiers = (meta.tiers as [number, number, number][] | undefined) ?? [];
  tiers.forEach(([z0, z1, setback], i) => {
    edges.push({ name: `tier${i}-foot`, z: z0, face: D / 2 - setback });
    edges.push({ name: `tier${i}-top`, z: z1, face: D / 2 - setback });
  });
  for (const e of edges) v(e.name, [W * 0.2, e.z + 1.5, e.face + 24], [0, e.z + 1.5, e.face]);
  v('crown', [W * 0.4, H + 12, D / 2 + 45], [0, H - 8, 0]);
  return views;
}

/** Mid-height of the first tier band, if the asset declares tiers. */
function tiers0(meta: AssetMeta): number | undefined {
  const t = (meta.tiers as [number, number, number][] | undefined)?.[0];
  return t ? (t[0] + t[1]) / 2 : undefined;
}

function parseList(spec: string | null, all: number): number[] {
  if (!spec || spec === 'all') return Array.from({ length: all }, (_, i) => i);
  return spec.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }).filter((n) => Number.isInteger(n) && n >= 0 && n < all);
}

export async function runInspect(params: URLSearchParams) {
  const id = params.get('inspect')!;
  const entry = getAsset(id);
  if (!entry) {
    setStatus(`?inspect=: no asset "${id}" in the manifest.`);
    window.__READY = true;
    return;
  }
  const lightParam = params.get('light') ?? 'day';
  const day = !isLightName(lightParam) || lightParam === 'day';
  const scale = (params.get('scale') ?? '1,1,1').split(',').map(Number) as [number, number, number];
  const time = { value: 12 };

  const renderer = createRenderer(1);
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.3, 4000);
  const scene = createScene(time, null);
  if (day) applyDaylight(scene);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.sidewalk), roughness: 0.95 }));
  scene.add(ground);

  const textures = await loadFacadeTextures(renderer, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const uniforms = createFacadeUniforms(time, 0, textures);
  uniforms.uDay.value = day ? 1 : 0;
  uniforms.uFacadePick.value = Number(params.get('facade') ?? -1);
  uniforms.uGridOverlay.value = params.get('overlay') === '1' ? 1 : 0;
  const material = createFacadeMaterial(uniforms);
  const { batch, lod } = await buildFacadeBatch(
    [{ asset: id, position: [0, 0, 0], rotationY: 0, scale, seed: 1 }], new AssetLoader(), material);
  scene.add(batch);
  lod.showAll();
  captureCityEnvironment(renderer, scene, null);
  // Glass reflects a capture taken away from the building (the probe avoids its footprint).
  uniforms.uGlassEnv.value = captureGlassEnvironment(renderer, scene, null, [ground]);
  uniforms.uGlassOn.value = 1;

  const post = createPost(renderer, scene, camera, QUALITY_PRESETS.high, undefined, day ? 'day' : 'filmic');
  if (day) post.bloom.intensity = 0.35;
  await post.ready;

  const views = inspectViews(entry.meta, scale);
  const setView = (view: InspectView) => {
    camera.position.copy(view.position);
    camera.lookAt(view.target);
    return view;
  };

  if (params.get('sheet') === '1') {
    const names = params.get('views');
    const cols = names && names !== 'all' ? views.filter((v) => names.split(',').includes(v.name)) : views;
    const rows = entry.meta.shader === 'facade' && params.has('facades') ? parseList(params.get('facades'), FACADE_NAMES.length) : [uniforms.uFacadePick.value];
    const [tw, th] = (params.get('tile') ?? '360x240').split('x').map(Number);
    renderer.setPixelRatio(1);
    renderer.setSize(tw, th);
    post.composer.setSize(tw, th);
    camera.aspect = tw / th;
    camera.updateProjectionMatrix();
    const label = 18;
    const sheet = document.createElement('canvas');
    sheet.width = tw * cols.length;
    sheet.height = (th + label) * rows.length;
    const ctx = sheet.getContext('2d')!;
    ctx.fillStyle = '#202020';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.font = '12px monospace';
    for (let r = 0; r < rows.length; r++) {
      uniforms.uFacadePick.value = rows[r];
      for (let c = 0; c < cols.length; c++) {
        setView(cols[c]);
        post.composer.render(0);
        // Same task as the render: the drawing buffer still holds the frame.
        ctx.drawImage(renderer.domElement, c * tw, r * (th + label) + label);
        ctx.fillStyle = '#ffd400';
        ctx.fillText(`${rows[r] >= 0 ? FACADE_NAMES[rows[r]] : 'seed'} · ${cols[c].name}`, c * tw + 4, r * (th + label) + 13);
      }
    }
    renderer.domElement.style.display = 'none';
    sheet.id = 'inspect-sheet';
    document.body.style.overflow = 'auto';
    document.body.appendChild(sheet);
    window.__READY = true;
    return;
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  let index = Math.max(0, views.findIndex((v) => v.name === params.get('view')));
  const apply = () => {
    const view = setView(views[index]);
    controls.target.copy(view.target);
    controls.update();
    const f = uniforms.uFacadePick.value;
    setStatus(`${id} · view ${views[index].name} (V) · facade ${f >= 0 ? FACADE_NAMES[f] : 'by seed'} ([ ]) · overlay ${uniforms.uGridOverlay.value ? 'on' : 'off'} (O)`);
  };
  apply();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'BracketRight' || e.code === 'BracketLeft') {
      const n = FACADE_NAMES.length, f = uniforms.uFacadePick.value;
      uniforms.uFacadePick.value = f < 0 ? 0 : (f + (e.code === 'BracketRight' ? 1 : n - 1)) % n;
    } else if (e.code === 'KeyO') {
      uniforms.uGridOverlay.value = 1 - uniforms.uGridOverlay.value;
    } else if (e.code === 'KeyV') {
      index = (index + 1) % views.length;
      setView(views[index]);
      controls.target.copy(views[index].target);
    } else {
      return;
    }
    apply();
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.composer.setSize(window.innerWidth, window.innerHeight);
  });
  let frames = 0;
  renderer.setAnimationLoop(() => {
    controls.update();
    post.composer.render(1 / 60);
    if (++frames === 3) window.__READY = true;
  });
}
