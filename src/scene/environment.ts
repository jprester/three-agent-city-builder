import * as THREE from 'three';
import palette from '../../art/style/palette.json';
import type { Layout } from '../systems/layout';

const color = (name: keyof typeof palette) => new THREE.Color(palette[name]);

export function createRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.body.appendChild(renderer.domElement);
  return renderer;
}

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = color('sky');
  scene.fog = new THREE.FogExp2(color('fog'), 0.0022);

  scene.add(new THREE.HemisphereLight(0x3a4a66, 0x0a0b0f, 0.6));
  const moon = new THREE.DirectionalLight(0x8fa6d8, 0.5);
  moon.position.set(-120, 200, 80);
  scene.add(moon);
  return scene;
}

/** Ground plane plus raised sidewalk slabs for each block in the layout. */
export function createGround(layout: Layout | null): THREE.Group {
  const group = new THREE.Group();
  const [w, d] = layout?.size ?? [400, 400];
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 3, d * 3),
    new THREE.MeshStandardMaterial({ color: color('road'), roughness: 0.6, metalness: 0.1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  if (layout) {
    const slab = new THREE.MeshStandardMaterial({ color: color('sidewalk'), roughness: 0.9 });
    for (const b of layout.blocks) {
      const bw = b.max[0] - b.min[0] + 3;
      const bd = b.max[1] - b.min[1] + 3;
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.2, bd), slab);
      m.position.set((b.min[0] + b.max[0]) / 2, 0.1, (b.min[1] + b.max[1]) / 2);
      group.add(m);
    }
  }
  return group;
}
