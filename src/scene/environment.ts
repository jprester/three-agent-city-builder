import * as THREE from 'three';
import palette from '../../art/style/palette.json';

const color = (name: keyof typeof palette) => new THREE.Color(palette[name]);

export function createRenderer(maxPixelRatio: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.body.appendChild(renderer.domElement);
  return renderer;
}

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = color('sky');
  scene.fog = new THREE.FogExp2(color('haze'), 0.0011);

  scene.add(new THREE.HemisphereLight(0x3a4a66, 0x0a0b0f, 0.6));
  const moon = new THREE.DirectionalLight(0x8fa6d8, 0.5);
  moon.position.set(-120, 200, 80);
  scene.add(moon);
  return scene;
}
