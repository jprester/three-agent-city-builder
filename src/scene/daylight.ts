import * as THREE from 'three';
import palette from '../../art/style/palette.json';

const color = (name: keyof typeof palette) => new THREE.Color(palette[name]);

/** `?light=`: the scene's lighting. Night is the piece; day exists to read surfaces honestly. */
export const LIGHT_NAMES = ['night', 'day'] as const;
export type LightName = (typeof LIGHT_NAMES)[number];
export const isLightName = (value: string): value is LightName => (LIGHT_NAMES as readonly string[]).includes(value);

/** Extinction per meter at street level by day (night: FOG_DENSITY in environment.ts). */
export const DAY_FOG_DENSITY = 0.00028;

/**
 * Turn the night scene (createScene) into an overcast-bright day: the night's cool fill lights
 * give way to a low warm sun and a blue sky / warm ground hemisphere light, the fog becomes a
 * pale haze, and the sky dome switches to its day branch. Lightning stops. The facade and
 * ground shaders follow `uDay` (set by the caller) to drop their painted night light.
 *
 * No shadow maps: the city has none at night either, and the inspect view reads form from the
 * sun's direction alone.
 */
export function applyDaylight(scene: THREE.Scene) {
  for (const name of ['night-hemi', 'night-sky']) {
    const light = scene.getObjectByName(name);
    if (light) light.removeFromParent();
  }
  const sun = new THREE.DirectionalLight(color('day_sun'), 2.6);
  sun.name = 'day-sun';
  // Afternoon sun from the south-west, 38° up: grazing enough to model ribs and setbacks.
  sun.position.set(-260, 300, -240);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(color('day_zenith').lerp(color('day_horizon'), 0.5), color('day_bounce'), 1.1);
  hemi.name = 'day-hemi';
  scene.add(hemi);

  const haze = color('day_horizon');
  scene.background = haze.clone();
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(haze);
  fog.density = DAY_FOG_DENSITY;

  const sky = scene.getObjectByName('sky') as THREE.Mesh | undefined;
  if (sky) {
    const u = (sky.material as THREE.ShaderMaterial).uniforms;
    u.uDay.value = 1;
    u.uZenith.value = color('day_zenith');
    u.uHorizon.value = haze.clone();
    u.uRidge.value = color('day_ridge');
    u.uSunDir.value = sun.position.clone().normalize();
    u.uSunColor.value = color('day_sun');
  }
  // No lightning by day.
  scene.userData.update = () => {};
}
