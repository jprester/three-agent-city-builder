// Start of the surface code (it replaces color_fragment): decode the surface type and
// building data, fit whole cells to the facade module, the wall material, tint and grime,
// and the outputs every branch writes (fBase, fEmit, fRefl, fWallLight, fRough, fMetal).
export const SURFACE_SETUP = /* glsl */ `
int fType = int(vSurf.r * 16.0);
// Residential towers shade as residential walls, with more windows lit (the night photos show
// 50-60 %) and a cladding color instead of faded paint.
bool fTowerRes = fType == T_TOWER_RES;
if (fTowerRes) {
  fType = T_RES;
  fLitRange = vec2(0.48, 0.68);
}
// Glass commercial blocks shade as curtain wall: most floors lit in cool office white (the
// Tokyo night photos), and unlit panes reflect the city like the photographic towers.
bool fGlass = fType == T_GLASS;
if (fGlass) {
  fType = T_CURTAIN;
  fLitRange = vec2(0.85, 0.97);
  fOffice = vec3(1.0, 0.3, 0.75);
  fGlassSkin = true;
}
float fFill = vSurf.g;
float fTint = vSurf.b;
vec2 fUv = vFacadeUv;
// Whole cells per facade module: the layout scales buildings (0.6-1.35), so a band built as
// whole floors and bays no longer is; stretch the cells slightly so it is again, and no row
// or column is cut at a band's edge. The atlas fits its own floor and bay below.
vec2 fCellFit = fType == T_OFFICE ? CELL_OFFICE : fType == T_CURTAIN ? CELL_CURTAIN
              : (fType == T_RES || fType == T_CAGE) ? CELL_RES : fType == T_PODIUM ? CELL_PODIUM : vec2(0.0);
if (fCellFit.x > 0.0) fUv *= fWholeFit(vFace, fCellFit);
// Inspect overlay: grid coordinate in cells (x: bays or cells across, y: floors); -1 = none.
vec2 fGridUv = fCellFit.x > 0.0 ? fUv / fCellFit : vec2(-1.0);
vec2 fFw = max(fwidth(fUv), vec2(1e-4));
float fSeed = vInstSeed;
fNormalW = normalize(vFNormal);
vec3 fUp = vec3(0.0, 1.0, 0.0);
vec3 fT = abs(fNormalW.y) < 0.9 ? normalize(cross(fUp, fNormalW)) : vec3(1.0, 0.0, 0.0);
vec3 fB = normalize(cross(fNormalW, fT));
vec3 fV = normalize(cameraPosition - vFWorld);
vec3 fVt = vec3(dot(fV, fT), dot(fV, fB), dot(fV, fNormalW));

// Wall material per building: residential walls lean to mosaic tile and stained concrete,
// office walls to panels, slate and metal.
float fPick = fract(fSeed * 23.71);
int fMat = fType == T_OFFICE ? (fPick < 0.3 ? 7 : fPick < 0.55 ? 5 : fPick < 0.75 ? 6 : 1)
         : fType == T_ROOF ? (fFill > 0.5 ? 0 : fPick < 0.5 ? 3 : 4)
         : (fPick < 0.38 ? 0 : fPick < 0.58 ? 1 : fPick < 0.74 ? 4 : fPick < 0.88 ? 3 : 5);
// Roof fill 1 is a tiled floor (station platforms): 30 cm tiles instead of wall mosaic.
float fMatSize = fType == T_ROOF && fFill > 0.5 ? 3.6
               : fMat == 0 ? 2.4 : fMat == 5 ? 3.2 : (fMat == 2 || fMat == 6) ? 2.0 : 3.0;
vec2 fGrad;
vec4 fWall = wallSample(fMat, fUv + vec2(fSeed * 37.0, 0.0), fMatSize, fGrad);
// Per-building tint (faded paint / dirty tile), then grime streaks running down from
// sills and AC units, darker near the ground.
vec3 fTintCol = vec3(1.0 + 0.1 * (fract(fSeed * 5.3) - 0.5), 1.0, 1.0 - 0.12 * (fract(fSeed * 5.3) - 0.5));
// Photographic albedo is daylight-bright; walls at 2 a.m. only show where light reaches them.
vec3 fBase = fWall.rgb * fTintCol * mix(0.3, 0.6, fTint) * (0.75 + 0.35 * fract(fSeed * 13.7));
float fStreak = fNoise(vec2(fUv.x * 2.1 + fSeed * 50.0, fUv.y * 0.04)) * fNoise(vec2(fUv.x * 0.7, fUv.y * 0.3 + fSeed * 9.0));
float fGrime = 1.0 - 0.55 * smoothstep(0.15, 0.6, fStreak) - 0.2 * (1.0 - smoothstep(0.0, 12.0, vFWorld.y));
// Old residential slabs: a third get faded paint over the tile/concrete.
if (fTowerRes) {
  // Terracotta, cream tile or charcoal; a quarter keep the plain tile/concrete.
  float k = fract(fSeed * 17.9);
  if (k < 0.75) fBase = mix(fBase, P_CLAD[int(k / 0.25)] * mix(0.45, 0.75, fTint) * dot(fWall.rgb, vec3(0.5)) * 2.0, 0.85);
} else if ((fType == T_RES || fType == T_CAGE || fType == T_TRIM) && fract(fSeed * 41.3) < 0.45) {
  vec3 pc = P_PAINT[int(fract(fSeed * 17.9) * 4.0)];
  fBase = mix(fBase, pc * mix(0.45, 0.75, fTint) * dot(fWall.rgb, vec3(0.5)) * 2.0, 0.8);
}
// Rhythm between the windows: floor slab bands and faint pilasters at each bay.
if (fType == T_RES || fType == T_OFFICE) {
  vec2 cs = fType == T_OFFICE ? CELL_OFFICE : CELL_RES;
  float band = fBox(fract(fUv.y / cs.y) * cs.y, 0.0, 0.28, fFw.y);
  float pil = fBox(fract(fUv.x / cs.x + 0.5 / cs.x) * cs.x, 0.0, 0.18, fFw.x) * step(0.5, fract(fSeed * 9.7));
  fBase *= 1.0 - 0.35 * band * (1.0 - smoothstep(0.1, 0.3, fFw.y / cs.y));
  fBase *= 1.0 + 0.15 * pil;
}
// Water staining follows sills and bay joints instead of covering all walls equally.
if (fType == T_RES) {
  vec2 cp = mod(fUv, CELL_RES);
  float belowSill = exp(-max(0.9 - cp.y, 0.0) * 2.8) * (1.0 - step(0.9, cp.y));
  float drip = fBox(cp.x, 0.75, 2.45, fFw.x) * (0.3 + 0.7 * fNoise(vec2(fUv.x * 12.0, floor(fUv.y / CELL_RES.y))));
  fBase *= 1.0 - 0.24 * belowSill * drip;
}
fBase *= mix(1.0, fGrime, 0.65);
vec3 fEmit = vec3(0.0);
// The share of fEmit that is glass reflecting the city and sky (not light from inside): the
// day block keeps it while it dims the painted night light.
vec3 fRefl = vec3(0.0);
// Light arriving on opaque wall surfaces (added as fBase * fWallLight at the end).
vec3 fWallLight = vec3(0.0);
float fRough = mix(0.75, 0.97, fWall.a);
float fMetal = (fMat == 2 || fMat == 6) ? 0.35 : 0.0;
// Relief from the material's luminance.
fNormalW = normalize(fNormalW - (fT * fGrad.x + fB * fGrad.y) * 2.5);

`;
