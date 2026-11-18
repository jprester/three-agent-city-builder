// Vertex chunks of the facade shader: per-instance seed, scale compensation and the
// meter-scale facade UVs (see src/materials/facade.ts for where each is spliced in).

export const VERTEX_PARS = /* glsl */ `
uniform float uSeed;
// Facade module (lib.mesh MeshBuilder module): the band a face belongs to, in meters before
// the layout's scale, which must hold whole cells (floors and bays). 0: no module.
attribute vec3 face;
// xy: the module at this instance's scale; z: 1 if geometry sits on its cells (locked).
flat varying vec3 vFace;
varying vec2 vFacadeUv;
// Discrete face data and random seeds must not acquire interpolation rounding noise.
flat varying vec3 vSurf;
flat varying float vInstSeed;
flat varying float vInstPaint;
flat varying float vInstBrake;
flat varying vec2 vInstSignal;
varying vec3 vFWorld;
varying vec3 vFNormal;
varying vec2 vRawUv;
`;

// After batching_vertex: the instance matrix is known; derive scale compensation and seed.
export const VERTEX_INSTANCE = /* glsl */ `
#include <batching_vertex>
mat4 fInst = mat4(1.0);
#ifdef USE_BATCHING
  fInst = batchingMatrix;
#endif
#ifdef USE_INSTANCING
  fInst = instanceMatrix;
#endif
vec3 fScale = vec3(length(fInst[0].xyz), length(fInst[1].xyz), length(fInst[2].xyz));
// u runs along local x on faces facing ±z, along local z on faces facing ±x; v runs up
// (horizontal faces use the other horizontal axis).
bool fAlongX = abs(normal.z) >= abs(normal.x);
float fSu = fAlongX ? fScale.x : fScale.z;
float fSv = abs(normal.y) > 0.7 ? (fAlongX ? fScale.z : fScale.x) : fScale.y;
vFacadeUv = vec2(uv.x * fSu, (1.0 - uv.y) * fSv);   // glTF stores 1 - v
vFace = vec3(face.xy * vec2(fSu, fSv), face.z);
vSurf = color.rgb;
vRawUv = vec2(uv.x, 1.0 - uv.y);
vInstSeed = fract(sin(dot(fInst[3].xz, vec2(12.9898, 78.233)) + uSeed * 0.0137) * 43758.5453);
vFNormal = normalize(mat3(fInst) * normal);
// Moving cars carry their paint pick in a slight height scale (src/systems/vehicles.ts),
// since their position seed changes as they drive; static instances use the seed.
vInstPaint = abs(fScale.y - 1.0) < 1e-5 ? vInstSeed : clamp((fScale.y - 1.0) * 64.0, 0.0, 0.999);
// Braking cars are 0.4 % wider (src/systems/vehicles.ts): their tail lamps burn brighter.
vInstBrake = abs(fScale.x - 1.004) < 0.001 ? 1.0 : 0.0;
// Traffic signals carry their junction's cycle offset (x scale 1.01..1.03) and phase (z
// scale 1.01 = phase 1); see layout signals in src/systems/instancing.ts.
vInstSignal = vec2(clamp((fScale.x - 1.01) / 0.02, 0.0, 1.0), step(1.005, fScale.z));
`;

export const VERTEX_WORLD = /* glsl */ `
#include <project_vertex>
vFWorld = (fInst * vec4(transformed, 1.0)).xyz;
vFWorld = (modelMatrix * vec4(vFWorld, 1.0)).xyz;
vFNormal = normalize(mat3(modelMatrix) * vFNormal);
`;
