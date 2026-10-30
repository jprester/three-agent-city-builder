import type * as THREE from 'three';
import type { FacadeUniforms } from '../materials/facade';
import type { GroundUniforms } from '../materials/ground';
import type { Post } from '../scene/post';
import type { Clock } from '../systems/clock';

/**
 * Debug tuning panel, shown only with `?debug=1`. lil-gui is imported lazily so
 * it stays out of the normal bundle path. Later phases add their own folders.
 */
export async function createDebugGui(renderer: THREE.WebGLRenderer, scene: THREE.Scene, clock: Clock, parts: { post: Post; facade: FacadeUniforms; ground: GroundUniforms }) {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'debug' });

  const look = gui.addFolder('look');
  const fog = scene.fog as THREE.FogExp2 | null;
  if (fog && 'density' in fog) look.add(fog, 'density', 0, 0.006, 0.0001).name('fog density');
  look.add(parts.facade.uWindowGain, 'value', 0, 4, 0.01).name('window gain');
  look.add(parts.ground.uWet, 'value', 0, 3, 0.01).name('wet reflection');
  look.add(parts.post.bloom, 'intensity', 0, 4, 0.01).name('bloom');
  look.add(parts.post.bloom.luminanceMaterial, 'threshold', 0, 3, 0.01).name('bloom threshold');
  const grade = parts.post.grade.settings;
  const applyGrade = () => parts.post.grade.apply();
  look.add(grade, 'exposure', 0.5, 1.5, 0.01).name('exposure').onChange(applyGrade);
  look.add(grade, 'saturation', 0, 1.5, 0.01).name('saturation').onChange(applyGrade);
  look.add(grade, 'contrast', 0.5, 1.5, 0.01).name('contrast').onChange(applyGrade);
  look.add(grade, 'highlightDesat', 0, 0.5, 0.01).name('highlight desat').onChange(applyGrade);
  look.add(grade, 'lift', 0, 0.03, 0.001).name('black lift').onChange(applyGrade);

  const info = gui.addFolder('stats');
  // fps and frame time (smoothed), and the pixel ratio dynamic resolution has settled on.
  const readout = { fps: 0, 'frame ms': 0, 'pixel ratio': 0, time: 0, calls: 0, triangles: 0 };
  info.add(readout, 'fps').disable().listen();
  info.add(readout, 'frame ms').disable().listen();
  info.add(readout, 'pixel ratio').disable().listen();
  info.add(readout, 'time').disable().listen();
  let last = performance.now(), avg = 16.7;
  info.add(readout, 'calls').disable().listen();
  info.add(readout, 'triangles').disable().listen();

  return {
    gui,
    /** Call once per frame after rendering. */
    update() {
      const now = performance.now();
      avg += (Math.min(now - last, 250) - avg) * 0.05;
      last = now;
      readout.fps = Math.round(1000 / avg);
      readout['frame ms'] = Math.round(avg * 10) / 10;
      readout['pixel ratio'] = Math.round(renderer.getPixelRatio() * 1000) / 1000;
      readout.time = Math.round(clock.time * 100) / 100;
      readout.calls = renderer.info.render.calls;
      readout.triangles = renderer.info.render.triangles;
    },
  };
}
