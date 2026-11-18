import { SIGNAL } from '../../../art/layouts/lib/traffic.mjs';
import { SCREEN_COLS, SCREEN_COUNT, SCREEN_ROWS } from '../../scene/screens';

// Surface branches of the if/else-if chain, and its end: roofs, trim, foliage, metal (cars,
// rails, steel), lit soffits, video screens, car-park decks and light fixtures (lamps, signals).
export const SURFACE_PROPS = /* glsl */ `} else if (fType == T_ROOF) {
  fBase *= 0.7;
  // Tiled floors: halve the grout contrast so the tiles read as a floor, not a net.
  if (fFill > 0.5) fBase *= mix(1.0, 0.433 / max(dot(fWall.rgb, vec3(0.333)), 0.05), 0.5);
} else if (fType == T_TRIM) {
  fBase *= 1.05;
} else if (fType == T_FOLIAGE) {
  // Tree crowns: dark green leaf clumps, varied per tree; lamps below light them warm.
  float leaf = fNoise(vFWorld.xz * 1.7 + vFWorld.y * 0.9) * fNoise(vFWorld.xz * 0.45 + fSeed * 7.0);
  fBase = P_FOLIAGE * mix(0.55, 1.35, leaf) * mix(0.8, 1.2, fract(fSeed * 19.3)) * mix(0.8, 1.2, fTint);
  fRough = 0.95;
} else if (fType == T_METAL) {
  vec2 fSteelRelief = vec2(0.0);
  fBase = P_METAL * mix(0.7, 1.6, fNoise(fUv * 2.0 + fSeed * 9.0));
  fRough = 0.55;
  fMetal = 0.5;
  // Vehicle subtypes use the otherwise unused metal fill channel; existing metal stays 0.
  if (fFill > 0.15 && fFill < 0.35) {
    // Fill 0.2: a random paint per car; 0.3: the fixed paint P_CAR[tint * 12] (taxis).
    float roadDirt = mix(0.65, 0.9, smoothstep(0.2, 0.7, fUv.y));
    int pick = fFill < 0.25 ? CAR_PICK[min(int(vInstPaint * 16.0), 15)] : min(int(fTint * 12.0), 11);
    fBase = P_CAR[pick] * roadDirt * mix(0.9, 1.0, fNoise(fUv * 6.0));
    fRough = 0.32; fMetal = 0.25;
  } else if (fFill > 0.05 && fFill < 0.15) {
    // Fill 0.1: a lit interior surface (monorail cars and station fittings). Tint packs the
    // finish (integer part of tint * 4: white panel, fabric, carpet, wood) and its glow (fraction).
    float k = fTint * 4.0;
    vec3 ic = P_INTERIOR[min(int(k), 3)];
    fBase = ic * 0.25; fRough = 0.8; fMetal = 0.0;
    fEmit = ic * fract(k);
  } else if (fFill > 0.35 && fFill < 0.45) {
    // Fill 0.4: painted structural steel (monorail girders, piers, portals). The fixed paint
    // P_CAR[tint * 12] over the plated slate cell (seams, bolt rows, mottling, normalised to
    // its mean), dirtied by long rain streaks; the cell's relief stays on the normal.
    vec2 sg;
    float plate = dot(wallSample(7, fUv, 3.0, sg).rgb, vec3(0.333)) / 0.101;
    float streak = fNoise(vec2(fUv.x * 1.3 + fSeed * 21.0, fUv.y * 0.12));
    fBase = P_CAR[min(int(fTint * 12.0), 11)] * mix(1.0, plate, 0.8) * (1.0 - 0.35 * smoothstep(0.3, 0.75, streak));
    fRough = 0.5; fMetal = 0.3;
    fSteelRelief = sg;
  } else if (fFill > 0.45 && fFill < 0.65) {
    // Vehicle and station glass (cars, monorail cab and cars, platform screens). Unlit it was a
    // black hole in the body, the monorail's wraparound cab most of all: it reflects the street
    // like the shopfront glass (street-canyon lookup, so low panes see facades, not sky), but as
    // tinted glass at half strength: at full Fresnel the faceted cab and the platform screens
    // read as chrome.
    fBase = P_GLASS; fRough = 0.12; fMetal = 0.65;
    fRefl = 0.5 * glassReflection(fV, normalize(vFNormal), fVt.z, fRough, vec3(0.0), 0.12, vFWorld, 20.0);
    fEmit += fRefl;
  } else if (fFill > 0.65) {
    fBase = P_METAL * 0.25; fRough = 0.95; fMetal = 0.0;
  }
  fNormalW = normalize(vFNormal - (fT * fSteelRelief.x + fB * fSteelRelief.y) * 2.0);
} else if (fType == T_SOFFIT) {
  float tubes = fBox(fract(fUv.y / 1.1), 0.46, 0.54, fFw.y / 1.1) * fBox(fract(fUv.x / 1.8), 0.08, 0.92, fFw.x / 1.8)
    * step(0.25, fHash(vec2(floor(fUv.x / 1.8), fSeed * 11.0)));
  fBase = P_CONCRETE_DARK;
  float tenant = fHash(vec2(floor(fUv.x / CELL_PODIUM.x), fSeed * 31.7 + 6.0));
  vec3 tubeColor = tenant < 0.35 ? P_TUNGSTEN : P_FLUORESCENT;
  fEmit = tubeColor * (0.015 + tubes * mix(0.3, 1.3, tenant) * step(0.18, tenant));
} else if (fType == T_SCREEN) {
  // Video screen: abstract animated content (no real ads), LED pixel grid up close.
  vec2 sp = vRawUv;
  float sid = fFill * 17.0 + fTint * 5.0 + fSeed * 3.0;
  // Cycle through the poster atlas: hold each for ~7 s, cross-fade over 0.4 s, with a slow
  // push-in so the image lives. Portrait slots are sampled "cover" style.
  float cyc = uTime / 7.0 + sid;
  float clip = floor(cyc);
  float ct = fract(cyc);
  float n = float(${SCREEN_COUNT});
  vec2 zoom = (sp - 0.5) / (1.0 + 0.06 * ct) + 0.5;
  vec2 slot = vec2(1.0 / ${SCREEN_COLS}.0, 1.0 / ${SCREEN_ROWS}.0);
  vec2 pad = slot * vec2(0.01, 0.005);
  float ia = floor(fHash(vec2(clip, sid)) * n), ib = floor(fHash(vec2(clip - 1.0, sid)) * n);
  vec2 ua = vec2(mod(ia, ${SCREEN_COLS}.0), ${SCREEN_ROWS - 1}.0 - floor(ia / ${SCREEN_COLS}.0)) * slot + pad + zoom * (slot - 2.0 * pad);
  vec2 ub = vec2(mod(ib, ${SCREEN_COLS}.0), ${SCREEN_ROWS - 1}.0 - floor(ib / ${SCREEN_COLS}.0)) * slot + pad + zoom * (slot - 2.0 * pad);
  vec3 img = mix(texture2D(uScreens, ub).rgb, texture2D(uScreens, ua).rgb, smoothstep(0.0, 0.06, ct));
  // Scan shimmer.
  img *= 0.92 + 0.08 * sin(sp.y * 180.0 - uTime * 6.0);
  // LED pixels: visible up close, averaged away with distance.
  vec2 led = fract(sp * vec2(160.0, 240.0));
  float px = max(fwidth(sp.x) * 160.0, fwidth(sp.y) * 240.0);
  float dots = mix(fBox(led.x, 0.15, 0.85, 0.05) * fBox(led.y, 0.15, 0.85, 0.05), 0.5, smoothstep(0.3, 0.8, px));
  fBase = P_METAL;
  fEmit = img * dots * 1.9;
  fRough = 0.3;
  fNormalW = normalize(vFNormal);
} else if (fType == T_DECK) {
  // Car-park deck seen through the opening: dim concrete lit by ceiling tubes, columns every
  // 5.4 m, parked cars in 2.6 m bays (some with a taillight). v counts from the first deck.
  float dh = fFill * 8.0, band = fTint * 4.0;
  float vv = mod(fUv.y, dh);
  float h = vv - band;                          // height above the deck floor
  float room = dh - band;
  float tubes = fBox(h, room - 0.12, room - 0.04, fFw.y) * fBox(fract(fUv.x / 3.0), 0.1, 0.7, fFw.x / 3.0);
  float light = 0.25 + 0.75 * smoothstep(0.0, room, h);
  float col = fBox(fract(fUv.x / 5.4) * 5.4, 0.0, 0.5, fFw.x);
  float bay = floor(fUv.x / 2.6);
  float deckId = floor(fUv.y / dh);
  float hasCar = step(0.4, fHash(vec2(bay, deckId + fSeed * 17.0)));
  float bx = fract(fUv.x / 2.6) * 2.6;
  // Car silhouette: body up to 0.75 m, narrower cabin above (vans are taller).
  float van = step(0.8, fHash(vec2(bay, deckId + 3.0)));
  float body = fBox(bx, 0.35, 2.25, fFw.x) * fBox(h, 0.12, 0.75, fFw.y);
  float cabin = fBox(bx, 0.65 - 0.25 * van, 1.95 + 0.25 * van, fFw.x) * fBox(h, 0.7, 1.3 + 0.5 * van, fFw.y);
  float car = hasCar * max(body, cabin);
  float pc = fHash(vec2(bay, deckId + 7.0));
  vec3 carCol = pc < 0.3 ? P_METAL * 1.2 : pc < 0.55 ? P_CONCRETE * 1.4 : pc < 0.75 ? P_TILE * 1.6 : pc < 0.88 ? P_RED * 0.25 : P_TV * 0.18;
  carCol = mix(carCol, carCol * 0.45, cabin * (1.0 - body));   // windows darker than paint
  float tail = hasCar * step(0.8, fHash(vec2(bay, deckId + 9.0))) * fBox(h, 0.5, 0.65, fFw.y) * max(fBox(bx, 0.4, 0.6, fFw.x), fBox(bx, 2.0, 2.2, fFw.x));
  // Distant decks average to a lit band instead of aliasing.
  float far = smoothstep(0.05, 0.2, max(fFw.x, fFw.y));
  vec3 wall = P_CONCRETE * 0.6;
  fBase = mix(mix(wall, P_CONCRETE_DARK * 0.5, col), carCol, car);
  fEmit = P_FLUORESCENT * (0.035 * light * (1.0 - car * 0.6) + 1.6 * tubes) + P_RED * 1.5 * tail;
  fEmit = mix(fEmit, P_FLUORESCENT * (0.03 + 0.06), far);
  fRough = mix(0.85, 0.3, car);
  fNormalW = normalize(vFNormal);
} else if (fType == T_FIXTURE) {
  // fixture_colors in facade.json: sodium 0, white 0.25, cyan 0.5, blue 0.75, red 1.
  vec3 fc = fFill < 0.125 ? P_SODIUM : fFill < 0.375 ? P_FLUORESCENT : fFill < 0.625 ? P_CYAN : fFill < 0.875 ? P_TV : P_RED;
  fBase = fc * 0.2;
  // Accent strips glow softly; small point fixtures (lamps, aviation lights) burn hot.
  bool strip = fTint > 0.9;   // lib/surface.py fixture(strip=True)
  // Red point fixtures are aviation beacons and blink; red strips and vehicle lamps (tail
  // lights, boat sidelights) stay steady.
  float blink = fFill > 0.875 && fTint < 0.15 ? step(0.5, fract(uTime * 0.9 + fSeed * 3.0)) : 1.0;
  // Accent strips are white-dominant and soft; saturated cyan stripes on every tower read as
  // decoration rather than architecture. Point fixtures stay hot.
  if (strip) fc = mix(fc, vec3(1.0), 0.35);
  // Vehicle lamp panels (fixture(lamp=True), tint 0.3): between the two, enough to bloom.
  bool lamp = fTint > 0.15 && fTint < 0.5;
  float brake = lamp && fFill > 0.875 ? 1.0 + 1.6 * vInstBrake : 1.0;
  fEmit = fc * (strip ? 0.65 : lamp ? 2.4 : 4.0) * blink * brake;
  if (fTint > 0.6 && fTint <= 0.9) {
    // Traffic-signal lens (fixture(signal=True)): the same cycle as signalAt() in
    // art/layouts/lib/traffic.mjs. Lens by color: green (cyan), amber (sodium), red.
    float sp = ${SIGNAL.period.toFixed(1)}, sg = ${SIGNAL.green.toFixed(1)}, sa = ${SIGNAL.amber.toFixed(1)};
    float st = mod(uTime + vInstSignal.x * sp, sp) - vInstSignal.y * (sg + sa);
    float green = step(0.0, st) * step(st, sg - 1e-3), amber = step(sg, st) * step(st, sg + sa - 1e-3);
    float on = fFill < 0.125 ? amber : fFill < 0.625 ? green : 1.0 - green - amber;
    vec3 lensCol = fFill < 0.125 ? vec3(1.0, 0.55, 0.08) : fFill < 0.625 ? vec3(0.15, 1.0, 0.55) : vec3(1.0, 0.08, 0.05);
    fBase = lensCol * 0.05;
    fEmit = lensCol * mix(0.04, 5.0, on);
  }
  fNormalW = normalize(vFNormal);
}
`;
