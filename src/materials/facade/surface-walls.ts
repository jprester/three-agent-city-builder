import { SHOP_SET } from './constants';

// Surface branches of the if/else-if chain: windowed walls (T_RES, T_OFFICE, T_CURTAIN,
// T_CAGE) through windowLayer, and the shopfront podium (T_PODIUM) with its room cards.
export const SURFACE_WALLS = /* glsl */ `} else if (fType == T_RES || fType == T_OFFICE || fType == T_CURTAIN || fType == T_CAGE) {
  vec3 wEmit, filteredEmit, avgEmit, wSpill, wAvgSpill; float wMask, wFrame, wFrac, wAround, filteredMask;
  windowLayer(fType == T_CAGE ? T_RES : fType, fUv, fFw, fType == T_CAGE ? OPEN_GRID : fFill, fSeed, fVt,
              wEmit, wMask, wFrame, filteredEmit, filteredMask, avgEmit, wFrac, wAround, wSpill, wAvgSpill);
  // Filter interior detail first, retain the opening coverage, then average subpixel cells.
  vec2 cellSize = fType == T_OFFICE ? CELL_OFFICE : fType == T_CURTAIN ? CELL_CURTAIN : CELL_RES;
  float px = max(fFw.x / cellSize.x, fFw.y / cellSize.y);
  float toFiltered = smoothstep(0.12, 0.3, px);
  float toAvg = smoothstep(0.75, 1.5, px);
  vec3 e = mix(mix(wEmit, filteredEmit, toFiltered), avgEmit, toAvg);
  float m = mix(mix(wMask, filteredMask, toFiltered), wFrac * (fType == T_CAGE ? 1.0 : openFrac(fFill)), toAvg);
  float detail = 1.0 - toFiltered;
  vec3 glass = fType == T_CURTAIN ? mix(P_GLASS, P_METAL, 0.3) : P_GLASS;
  if (fType == T_CURTAIN) fBase = mix(P_METAL, P_CONCRETE_DARK, 0.3 * fTint);
  // Recess shadow around the opening.
  fBase *= 1.0 - 0.45 * wAround * detail;
  fBase = mix(fBase, glass, m);
  fBase = mix(fBase, P_METAL * 1.3, wFrame * detail);
  fRough = mix(fRough, 0.15, m * (1.0 - wFrame));
  fEmit = e;
  if (fGlass) {
    // Coated curtain-wall glass reflects strongly even head-on, and no two panes are quite
    // coplanar: a small per-pane tilt makes neighbors catch different parts of the city (it
    // fades with the window detail, before it can shimmer). Spandrel glass is back-painted:
    // the same reflection, weaker, with nothing lit behind it.
    vec2 pane = floor(fUv / CELL_CURTAIN);
    vec2 tilt = (vec2(fHash(pane + fSeed * 7.0), fHash(pane + fSeed * 7.0 + 3.7)) - 0.5) * 0.08 * detail;
    vec3 pn = normalize(fNormalW + fT * tilt.x + fB * tilt.y);
    vec3 r = glassReflection(fV, pn, fVt.z, fRough, e, 0.4, vFWorld, 28.0);
    fRefl = (1.0 - wFrame * detail) * mix(0.45, 1.0, m) * r;
    fEmit += fRefl;
  }
  // Window light on the surrounding wall (lights the wall's own albedo).
  fWallLight += mix(wSpill, wAvgSpill, toAvg);
  if (fType == T_CAGE) {
    float bars = max(1.0 - fBox(fract(fUv.x / 0.12), 0.15, 0.85, fFw.x / 0.12), 1.0 - fBox(fract(fUv.y / 0.4), 0.06, 0.94, fFw.y / 0.4));
    // Bars are 12 cm apart: fade to their average coverage before they alias (< ~8 px period).
    bars = mix(bars, 0.45, smoothstep(0.04, 0.16, max(fFw.x / 0.12, fFw.y / 0.4)));
    fBase = mix(fBase * 0.6, P_METAL * 1.4, bars);
    fEmit *= (1.0 - bars) * 0.8;
    fRough = mix(0.7, 0.5, bars);
    fMetal = bars * 0.4;
  }
} else if (fType == T_PODIUM) {
  float sid = floor(fUv.x / CELL_PODIUM.x);
  float x = fUv.x - sid * CELL_PODIUM.x;
  float s = fSeed * 31.7;
  float present = step(fHash(vec2(sid, s)), fFill);
  int shopCard = min(int(fHash(vec2(sid, s + 8.2)) * float(${SHOP_SET.tiles.length})), ${SHOP_SET.tiles.length - 1});
  int tenantKind = shopCard % 3;
  // The scene is late at night: convenience stores stay open; workshops mostly close.
  float openShare = tenantKind == 0 ? 0.9 : (tenantKind == 1 ? 0.65 : 0.3) * mix(1.0, 0.5, uNight);
  float open = step(fHash(vec2(sid, s + 1.3)), openShare) * present;
  float hCol = fHash(vec2(sid, s + 2.1));
  vec3 shopCol = hCol < 0.5 ? P_FLUORESCENT : hCol < 0.85 ? P_TUNGSTEN : mix(P_FLUORESCENT, P_TV, 0.5);
  float pier = 1.0 - fBox(x, 0.3, CELL_PODIUM.x - 0.3, fFw.x);
  float glassMask = fBox(fUv.y, 0.15, 3.25, fFw.y) * (1.0 - pier) * present;
  float stock = mix(0.45, 1.0, smoothstep(0.3, 2.2, fUv.y)) * (0.8 + 0.2 * fNoise(vec2(x * 1.5 + s, fUv.y * 0.8)));
  float strip = 1.6 * fBox(fUv.y, 2.95, 3.1, fFw.y);
  vec3 goods = mix(vec3(1.0), mix(P_TUNGSTEN, P_RED, fHash(vec2(floor(x / 0.7), sid + s))), 0.35 * fBox(fUv.y, 1.2, 2.6, fFw.y));
  shopCol *= goods;
  float ribs = 0.6 + 0.4 * smoothstep(0.3, 0.7, abs(fract(fUv.y * 7.0) - 0.5) * 2.0);
  ribs = mix(ribs, 0.8, smoothstep(0.035, 0.12, fFw.y));
  float finish = fHash(vec2(sid, s + 4.8));
  vec3 shutterPaint = finish < 0.3 ? P_METAL * 2.2 : finish < 0.65 ? P_CONCRETE : P_PAINT[int(finish * 4.0)];
  vec3 shutter = mix(shutterPaint, fBase, 0.35) * ribs * mix(0.6, 1.0, fGrime);
  // Repainted lower panels and a handle make closed shops individual without more signs.
  float repair = fBox(fUv.y, 0.25, 0.85 + finish * 0.8, fFw.y) * step(0.6, finish);
  shutter *= 1.0 - repair * 0.22;
  float handle = fBox(x, 2.05, 2.4, fFw.x) * fBox(fUv.y, 0.7, 0.77, fFw.y);
  shutter = mix(shutter, P_METAL, handle);
  fBase = mix(fBase, open > 0.5 ? P_GLASS : shutter, glassMask);
  vec3 shopRoom = interior(SHOP_BOX, SHOP_TILES[shopCard], vec2(x - 0.3, fUv.y - 0.15),
                           fVt, SHOP_PX_M, fFw) * mix(vec3(1.0), shopCol, 0.4);
  // Some entrances sit left of the display, others right, with a few double doors.
  float doorX = finish < 0.5 ? 1.55 : CELL_PODIUM.x - 1.55;
  float transom = mix(2.35, 2.8, fHash(vec2(sid, s + 5.1)));
  float shopFrame = max(fBox(x, doorX, doorX + 0.1, fFw.x), fBox(fUv.y, transom, transom + 0.08, fFw.y));
  shopFrame = max(shopFrame, fBox(x, 2.35, 2.43, fFw.x) * step(0.82, finish));
  fBase = mix(fBase, P_METAL, shopFrame * glassMask);
  fEmit = glassMask * open * (shopRoom * (1.5 + stock) + shopCol * strip * 0.25)
        * (1.0 - shopFrame);
  fEmit *= mix(0.6, 1.15, fHash(vec2(sid, s + 7.2)));
  fBase *= 1.0 - 0.4 * fBox(fUv.y, 3.35, 4.5, fFw.y);
  fRough = mix(fRough, open > 0.5 ? 0.2 : 0.6, glassMask);
  fMetal = (1.0 - open) * glassMask * 0.4;
`;
