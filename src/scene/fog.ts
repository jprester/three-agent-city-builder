import * as THREE from 'three';

/**
 * Height fog for every built-in material: replaces three's fog chunks once, globally.
 * The fog is exponential in height (thick at street level, thin above the roofs), integrated
 * along the view ray, so aerial views stay clear while streets and the distance haze over.
 *
 * scene.fog must be a FogExp2: its color is the fog color and its density the extinction
 * per meter at ground level (not three's squared exp2 density).
 */
export const FOG_FALLOFF = 1 / 110; // 1/m: density halves every ~76 m of height
/** Thin haze at every height (1/m), so the far ground fogs out fully even seen from above. */
export const FOG_FLOOR = 0.00018;

let installed = false;
export function installHeightFog() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;
  // mvPosition is in view space here; undo the view transform to get world space.
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float heightFog(vec3 world, float density) {
    vec3 rd = world - cameraPosition;
    float t = length(rd);
    rd /= max(t, 1e-4);
    float b = ${FOG_FALLOFF.toFixed(6)};
    float k = rd.y * b;
    float optical = density * exp(-max(cameraPosition.y, 0.0) * b) * (abs(k) < 1e-5 ? t : (1.0 - exp(-t * k)) / k);
    return 1.0 - exp(-optical - t * ${FOG_FLOOR.toFixed(6)});
  }
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = heightFog(vFogWorld, fogDensity);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, length(vFogWorld - cameraPosition));
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;
}
