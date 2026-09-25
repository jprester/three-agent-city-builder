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

  const info = gui.addFolder('stats');
  const readout = { time: 0, calls: 0, triangles: 0 };
  info.add(readout, 'time').disable().listen();
  info.add(readout, 'calls').disable().listen();
  info.add(readout, 'triangles').disable().listen();

  return {
    gui,
    /** Call once per frame after rendering. */
    update() {
      readout.time = Math.round(clock.time * 100) / 100;
      readout.calls = renderer.info.render.calls;
      readout.triangles = renderer.info.render.triangles;
    },
  };
}
