import { TOWER_POOL } from '../textures';
import { ATLAS_SIZE, TF_COUNT, TOWER_CITY_BUNDLES } from './constants';

// Surface branch (opens the if/else-if chain over fType, closed by SURFACE_PROPS):
// T_ATLAS, the baked tower facades (docs/FACADES.md), with glass reflection per style.
export const SURFACE_TOWERS = /* glsl */ `if (fType == T_ATLAS) {
  // Baked tower facade: bundle and facade per building, offset by whole bays/floors.
  // By seed from the city's pool, unless the face pins one (fill < 1: lib.surface.atlas_pin,
  // a landmark's own style) or inspect does.
  int fi = int(fract(fSeed * 3.17) * ${TOWER_CITY_BUNDLES}.0) * ${TOWER_POOL} + int(fract(fSeed * 11.3) * ${TOWER_POOL}.0);
  if (fFill < 0.98) fi = min(int(fFill * 64.0), ${TF_COUNT} - 1);
  if (uFacadePick >= 0) fi = min(uFacadePick, ${TF_COUNT} - 1);
  int bundle = TF_LAYER[fi];
  // R: the facade's grid (tools/textures/facade_grid.py), whose edges are floor lines (middle of
  // a spandrel) and bay lines (middle of a pier), holding whole floors and bays; Dm.zw its size.
  vec4 R = TF_RECT[fi];
  vec4 Dm = TF_DIM[fi];
  float perM = Dm.x / CELL_CURTAIN.y;
  // Whole floors up each module, and whole bays across it where the facade has a column
  // rhythm (ribbon glazing has none: its bay is the whole grid), so a tier starts and ends on
  // a floor line and a corner or rib on a bay line.
  bool hasBays = Dm.y > 0.0;
  Dm.y = abs(Dm.y);
  vec2 fit = fWholeFit(vFace, vec2(hasBays ? Dm.y / perM : 0.0, CELL_CURTAIN.y));
  vec2 L = fUv * fit * perM + vec2(floor(fract(fSeed * 5.1) * 9.0) * Dm.y, floor(fract(fSeed * 7.9) * 9.0) * Dm.x);
  vec2 Lw = mod(L, Dm.zw);
  vec2 auv = vec2(R.x + Lw.x, 1.0 - R.w + Lw.y);
  fGridUv = vec2(hasBays ? L.x / Dm.y : -1.0, L.y / Dm.x);
  vec4 dr; vec3 em, nm;
  towerSample(bundle, auv, dFdx(L), dFdy(L), dr, em, nm);
  fBase = dr.rgb * 0.5;
  // Pane-level roughness varies gently, while opaque spandrels stay matte.
  float pane = fHash(floor(fUv / CELL_CURTAIN) + fSeed * 13.0);
  fRough = clamp(dr.a + (pane - 0.5) * 0.08, 0.12, 0.95);
  fMetal = (1.0 - dr.a) * 0.4;
  float floorId = floor(L.y / Dm.x);
  // Not every floor is occupied: dark floors, then a slower per-bay variation so a whole
  // facade does not pulse as one sheet. Both fade to their mean before they alias.
  // Late at night (uNight) more floors go dark.
  float floorLit = mix(0.35, 1.2, fHash(vec2(floorId, fSeed * 31.0))) * step(0.2 + 0.25 * uNight, fHash(vec2(floorId, fSeed * 13.0 + 2.0)));
  float bayId = floor(L.x / Dm.y);
  float bayVar = mix(0.68, 1.18, fHash(vec2(bayId, fSeed * 23.0 + 7.0)));
  float bayM = max(Dm.y / perM, 0.1);
  bayVar = mix(bayVar, 0.95, smoothstep(0.25, 0.7, fFw.x / bayM));
  // Tenant bands: offices light in runs of whole floors, with long dark voids. The
  // variation fades to its mean before a floor is smaller than a pixel.
  float floorM = max(Dm.x / perM, 0.1);
  float groupSize = mix(4.0, 9.0, fract(fSeed * 9.7 + 0.31));
  float groupId = floor(floorId / groupSize);
  float groupOn = step(0.15, fHash(vec2(groupId, fSeed * 43.0 + 7.0)));
  float group = mix(0.12, 1.0, groupOn);
  floorLit *= mix(group, 0.78, smoothstep(0.35, 0.9, fFw.y / floorM));
  fEmit = em * 2.5 * floorLit * bayVar;
  // Spill: the emissive map blurred over ~a bay lights the frames and spandrels around windows.
  // One isotropic lookup in a mip about a bay across (never finer than the pixel's own): a
  // gradient footprint that long and thin made the anisotropic filter take a few discrete taps
  // along it instead of blurring, which left shifted copies of the lit rooms (ghost outlines,
  // light below the sill) on spandrels and dark panes.
  float spillTexels = 0.8 * max(Dm.y, Dm.x) * ${ATLAS_SIZE}.0;
  float pixelTexels = max(length(dFdx(L)), length(dFdy(L))) * ${ATLAS_SIZE}.0;
  vec3 emB = textureLod(uTowerEmit, vec3(auv, float(bundle)), log2(max(spillTexels, pixelTexels))).rgb;
  fWallLight += emB * floorLit * 0.6;
  vec3 n = nm * 2.0 - 1.0;
  // At a third of the map's strength: the generated normal maps model frames and sills, but also
  // carry the interiors' outlines as bumps, which lit as pale blobs on dark panes.
  fNormalW = normalize((fT * n.x + fB * n.y) * 0.35 + normalize(vFNormal) * max(n.z, 0.2));
  // Glass reflects the city, rippled by the pane normals (see glassReflection).
  float glassAmt = 1.0 - smoothstep(0.3, 0.6, dr.a);
  // The reflection takes only a hint of the photo's normal map: the generated maps carry the
  // interior's outlines (desks, people) as bumps, and a fully rippled reflection drew them as
  // ghost contours on dark panes.
  vec3 fReflN = normalize(mix(normalize(vFNormal), fNormalW, 0.2));
  fRefl = glassAmt * glassReflection(fV, fReflN, fVt.z, fRough, fEmit, 0.18, vFWorld, 0.0) * TF_TINT[fi];
  fEmit += fRefl;
`;
