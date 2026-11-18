// Window functions: opening patterns, office lighting, glass reflection of the city and the
// window layer (glass, frames, blinds, rooms, spill and its far-field average) for the
// residential, office, curtain and cage surface types.
export const FRAGMENT_WINDOWS = /* glsl */ `
// Opening pattern of a window face (lib/surface.py window_code): which cell columns have a
// window, the same on every floor. Codes: 0 blank, 63 all, 62 even, 61 odd, else a bit mask
// of columns 0..5. Everything window-related (glass, spill, distant fading) reads this.
const float OPEN_GRID = 63.5 / 64.0;
int openCode(float g) { return int(g * 64.0); }
float openCol(float g, float col) {
  int code = openCode(g);
  if (col < 0.0) return 0.0;
  if (code >= 63) return 1.0;
  if (code == 62) return 1.0 - mod(col, 2.0);
  if (code == 61) return mod(col, 2.0);
  if (col > 5.0) return 0.0;
  return mod(floor(float(code) / exp2(col)), 2.0);
}
// Share of columns with windows, for facade-mean LOD (column masks: over the masked span + 1).
float openFrac(float g) {
  int code = openCode(g);
  if (code >= 63) return 1.0;
  if (code >= 61) return 0.5;
  float n = 0.0, hi = 0.0;
  for (int i = 0; i < 6; i++) {
    float b = mod(floor(float(code) / exp2(float(i))), 2.0);
    n += b;
    if (b > 0.5) hi = float(i);
  }
  return n / (hi + 2.0);
}

// Office floors on glass skins are lit evenly; everywhere else each window has its own lamp.
float officeIntensity(vec2 cid, float s) {
  return fGlassSkin ? 0.75 + 0.8 * fHash(vec2(cid.y, floor(cid.x / 7.0)) + s + 2.9) : windowIntensity(cid, s);
}

// Light colour of a lit office window. Glass skins pick a tone per floor group (one tenant):
// about half warm, a third office white, some greener fluorescent, some half-dimmed, so distant
// glass reads as floors of different offices instead of one grey slab.
vec3 officeColor(vec2 cid, float s, float hTemp) {
  if (!fGlassSkin) return mix(windowColor(hTemp), OFFICE_WHITE, fOffice.z);
  float h = fHash(vec2(cid.y, floor(cid.x / 7.0)) + s + 8.3);
  if (h < 0.3) return OFFICE_WHITE;
  if (h < 0.58) return mix(OFFICE_WHITE, P_TUNGSTEN, 0.8);
  if (h < 0.78) return P_TUNGSTEN * vec3(1.0, 0.86, 0.66);
  if (h < 0.88) return mix(OFFICE_WHITE, P_FLUORESCENT, 0.85);
  return OFFICE_WHITE * 0.4;
}

// Seen from afar a lit office floor is a bright ceiling band (lit panels) over darker desks.
// q: height within the window (0..1). Mean over the window is ~1, so averages are unchanged.
float ceilingBand(float q) {
  return mix(0.5, 1.9, smoothstep(0.66, 0.88, q));
}

// Light of the window in cell cid (0 if unlit): same hashes and rules as windowLayer, so
// neighboring cells can contribute spill without seams at cell borders.
vec3 cellLight(int type, vec2 cid, float fill, float seed) {
  float s = seed * 97.13;
  if (openCol(fill, cid.x) < 0.5) return vec3(0.0);
  float litRatio = mix(fLitRange.x, fLitRange.y, fract(seed * 7.31)) * mix(1.0, 0.75, uNight);
  if (type == T_OFFICE || type == T_CURTAIN) {
    litRatio *= type == T_CURTAIN ? fOffice.x : 0.5;
    float floorOn = fHash(vec2(cid.y, floor(cid.x / 7.0) + s + 3.1));
    litRatio *= floorOn < fOffice.y ? 0.0 : floorOn > 0.9 ? 3.0 : 1.0;
  }
  if (fHash(cid + s + 17.7) > litRatio) return vec3(0.0);
  float hTemp = fHash(cid + s + 5.3);
  return officeColor(cid, s, hTemp) * officeIntensity(cid, s);
}

// Glass reflects the city: the startup cube capture along the reflected view ray, blurred by
// roughness and by the ray's spread over the pixel (so distant towers show a soft average
// instead of shimmering). Fresnel: faint head-on, strong at grazing angles. Lit rooms
// (emit) show through the reflection. f0: reflectance head-on (plain glass 0.18, coated more).
// street > 0: the pane stands in a street canyon of about that half-width; see below.
vec3 glassReflection(vec3 v, vec3 n, float vtz, float rough, vec3 emit, float f0, vec3 wp, float street) {
  vec3 rdir = reflect(-v, n);
  vec3 envC = skyRefl(rdir);
  if (uGlassOn > 0.5) {
    float spread = length(fwidth(rdir)) * 256.0;
    float lod = clamp(rough * 4.0 + log2(max(spread, 1.0)), 0.0, 7.0);
    vec3 look = rdir;
    if (street > 0.0) {
      // The capture is taken high in the tower district, so a ray reflected upward from a low
      // pane finds only sky there; in the street it would hit the facades across the road.
      // Where the ray meets a virtual ring of buildings (radius = street) below CANYON_TOP,
      // look toward the horizon at that hit's height instead, where the capture shows lit city.
      float hy = wp.y + rdir.y * street / max(length(rdir.xz), 0.05);
      vec3 across = normalize(vec3(rdir.x, clamp((hy - GLASS_CAPTURE_Y) / 250.0, -0.45, 0.15), rdir.z));
      look = normalize(mix(across, rdir, smoothstep(CANYON_TOP - 20.0, CANYON_TOP + 15.0, hy)));
    }
    envC = textureLod(uGlassEnv, look, lod).rgb;
  }
  float fres = f0 + (1.0 - f0) * pow(1.0 - clamp(vtz, 0.0, 1.0), 4.0);
  // A lit room behind the pane outshines its reflection at night; by day it does not.
  float roomLit = clamp(dot(emit, vec3(0.3, 0.5, 0.2)) * 1.5, 0.0, 1.0) * (1.0 - uDay);
  return envC * fres * (1.0 - 0.75 * roomLit) * uGlassGain;
}

// Window layer for residential / office / curtain facades (cage reuses residential).
void windowLayer(int type, vec2 uvm, vec2 fw, float fill, float seed, vec3 vt, out vec3 emit, out float mask, out float frame,
                 out vec3 filteredEmit, out float filteredMask, out vec3 avgEmit, out float windowFrac, out float around,
                 out vec3 spill, out vec3 avgSpill) {
  vec2 cell = type == T_OFFICE ? CELL_OFFICE : type == T_CURTAIN ? CELL_CURTAIN : CELL_RES;
  vec2 cid = floor(uvm / cell);
  vec2 p = uvm - cid * cell;           // meters inside the cell
  // A facade keeps one window family; the hash is the same on every floor and face.
  // Residential variants stay inside the 0.8..2.4 x 0.9..2.45 physical reveal used by
  // slab_a/b/d, so a shader style can never punch outside a modelled opening.
  int winStyle = int(fHash(vec2(seed * 73.1, float(type) * 11.7 + 4.0)) * 4.0);
  if (fGlassSkin) winStyle = winStyle < 2 ? 0 : 2;   // full glazing or a slim spandrel band
  vec4 r; // window rect x0, x1, y0, y1
  if (type == T_OFFICE) {
    if (winStyle == 0) r = vec4(0.08, cell.x - 0.08, 0.95, 2.95);          // wide punched
    else if (winStyle == 1) r = vec4(0.30, 1.30, 0.55, 3.05);              // tall narrow
    else if (winStyle == 2) r = vec4(0.20, 1.40, 1.05, 2.60);              // square punch
    else r = vec4(0.05, cell.x - 0.05, 1.25, 2.30);                        // ribbon
  } else if (type == T_CURTAIN) {
    if (winStyle == 0) r = vec4(0.05, cell.x - 0.05, 0.12, cell.y - 0.28); // full glazing
    else if (winStyle == 1) r = vec4(0.22, cell.x - 0.22, 0.55, cell.y - 0.20);
    else if (winStyle == 2) r = vec4(0.05, cell.x - 0.05, 0.35, cell.y - 0.45);
    else r = vec4(0.15, cell.x - 0.15, 1.00, cell.y - 0.70);
  } else {
    if (winStyle == 0) r = vec4(0.8, 2.4, 0.9, 2.45);                      // original 1:1
    else if (winStyle == 1) r = vec4(1.0, 2.2, 0.9, 2.45);                 // tall narrow
    else if (winStyle == 2) r = vec4(0.8, 2.4, 1.1, 2.25);                 // wide letterbox
    else r = vec4(1.05, 2.15, 1.05, 2.2);                                  // small punched
  }
  windowFrac = (r.y - r.x) * (r.w - r.z) / (cell.x * cell.y);

  float s = seed * 97.13;
  float present = openCol(fill, cid.x);
  float litRatio = mix(fLitRange.x, fLitRange.y, fract(seed * 7.31)) * mix(1.0, 0.75, uNight);
  float baseRatio = litRatio;
  if (type == T_OFFICE || type == T_CURTAIN) {
    litRatio *= type == T_CURTAIN ? fOffice.x : 0.5;
    baseRatio = litRatio;
    float floorOn = fHash(vec2(cid.y, floor(cid.x / 7.0) + s + 3.1));
    litRatio *= floorOn < fOffice.y ? 0.0 : floorOn > 0.9 ? 3.0 : 1.0;
    // Far away the dark floors average in too (glass skins have many of them).
    if (fGlassSkin) baseRatio *= 1.0 - fOffice.y;
  }
  float hLit = fHash(cid + s + 17.7);
  float lit = step(hLit, litRatio) * present;
  float hTemp = fHash(cid + s + 5.3);
  float hMod = fHash(cid + s + 9.1);
  // Mostly warm tungsten; fluorescent and TV-blue as the minority.
  vec3 col = officeColor(cid, s, hTemp);
  float inten = officeIntensity(cid, s);

  vec2 q = (p - r.xz) / (r.yw - r.xz);   // 0..1 across the window
  vec2 wsize = r.yw - r.xz;
  // Lit windows show a room card. Homes: one room per cell. Offices and glass: four cells share
  // one wide room, so neighboring panes look into different parts of the same floor.
  vec3 inside = vec3(0.0);
  if (lit > 0.5) {
    vec3 card;
    if (type == T_RES) {
      int k = int(fHash(cid + s + 21.0) * float(RES_CARDS));
      card = interior(RES_BOX, RES_TILES[k], vec2(p.x - ((r.x + r.y) * 0.5 - RES_BOX.x * 0.5), p.y - 0.15), vt, RES_PX_M, fw);
    } else {
      float g = floor(cid.x / 4.0);
      int k = int(fHash(vec2(g, cid.y) + s + 21.0) * float(OFF_CARDS));
      float x = ((cid.x - g * 4.0) * cell.x + p.x) * OFF_BOX.x / (4.0 * cell.x);
      card = interior(OFF_BOX, OFF_TILES[k], vec2(x, p.y - 0.2), vt, OFF_PX_M * 4.0 * cell.x / OFF_BOX.x, fw);
    }
    // Half the per-window brightness spread: at full spread bright rooms clip to a flat glow.
    inside = col * card * INTERIOR_GAIN * mix(1.0, inten, 0.5);
    // Glass skins: once the card blurs (a pane only a few pixels across), the ceiling band
    // takes over, so lit floors keep their structure instead of averaging to flat grey.
    if (fGlassSkin) {
      float band = smoothstep(0.04, 0.15, max(fw.x / cell.x, fw.y / cell.y));
      vec3 floorLit = col * 0.34 * ceilingBand(q.y) * mix(1.0, inten, 0.5);
      inside = mix(inside, floorLit, band);
    }
  }
  // Blinds (slats), curtains (fabric glowing through), or clear: about a third covered, so
  // most lit windows show their room card.
  if (hMod < 0.18) {
    float slat = 0.3 + 0.7 * smoothstep(0.3, 0.7, fract(q.y * 12.0));
    slat = mix(slat, 0.65, smoothstep(0.015, 0.05, fw.y));   // slats ~13 cm: average before they alias
    float drawn = step(1.0 - mix(0.35, 1.0, fract(hMod * 5.6)), q.y);
    inside = mix(inside, col * inten * 0.55 * slat, drawn);
  } else if (hMod < 0.3) {
    vec3 cloth = mix(vec3(0.82, 0.78, 0.68), vec3(0.48, 0.43, 0.37), fract(hMod * 17.0));
    float cover = fBox(q.x, hMod > 0.24 ? -0.1 : 0.5, hMod > 0.24 ? 0.5 : 1.1, 0.02);
    float folds = mix(0.75 + 0.25 * sin(q.x * 40.0), 0.75, smoothstep(0.02, 0.06, fw.x));
    inside = mix(inside, col * cloth * inten * 0.5 * folds, cover);
  }

  // Frame: border plus a family-specific mullion pattern. Tall windows get a transom,
  // letterbox windows two vertical mullions, punched panes a clean sheet of glass.
  float fwm = 0.05;
  float inner = fBox(p.x, r.x + fwm, r.y - fwm, fw.x) * fBox(p.y, r.z + fwm, r.w - fwm, fw.y);
  float bars = 0.0;
  if (type == T_OFFICE) {
    if (winStyle == 1) bars = fBox(q.y, 0.55, 0.565, fw.y / wsize.y);
    else if (winStyle == 3) bars = max(fBox(q.x, 0.32, 0.34, fw.x / wsize.x), fBox(q.x, 0.66, 0.68, fw.x / wsize.x));
    else bars = max(fBox(q.x, 0.49, 0.51, fw.x / wsize.x), fBox(q.y, 0.64, 0.665, fw.y / wsize.y));
  } else if (type != T_CURTAIN) {
    if (winStyle == 1) bars = fBox(q.y, 0.52, 0.535, fw.y / wsize.y);
    else if (winStyle == 2) bars = max(fBox(q.x, 0.32, 0.34, fw.x / wsize.x), fBox(q.x, 0.66, 0.68, fw.x / wsize.x));
    else if (winStyle == 3) bars = 0.0;
    else bars = max(fBox(q.x, 0.49, 0.51, fw.x / wsize.x), fBox(q.y, 0.64, 0.665, fw.y / wsize.y));
  }
  mask = fBox(p.x, r.x, r.y, fw.x) * fBox(p.y, r.z, r.w, fw.y) * present;
  frame = mask * (1.0 - inner * (1.0 - bars));
  // Recess shadow just around the opening.
  around = present * max(fBox(p.x, r.x - 0.14, r.y + 0.14, fw.x) * fBox(p.y, r.z - 0.1, r.w + 0.12, fw.y) - mask, 0.0);

  // Light from lit windows: a faint round glow on the wall from every window in the 3×3
  // neighborhood (elliptical falloff from the window center, so no rectangular contours),
  // plus the lit reveal: the recess right around this cell's own opening.
  vec2 wc = (r.xz + r.yw) * 0.5, wh = (r.yw - r.xz) * 0.5;
  spill = vec3(0.0);
  filteredEmit = vec3(0.0);
  filteredMask = 0.0;
  float filteredGlass = 0.0;
  // A 3x3 neighborhood covers footprints up to two cells wide, including at cell seams.
  // Larger footprints transition to the facade mean before reaching this limit.
  vec2 footprint = min(fw, cell * 2.0);
  vec4 glassRect = r + vec4(fwm, -fwm, fwm, -fwm);
  float barTransmission = type == T_CURTAIN ? 1.0 : 0.956;
  // Glass skins light most floors, so their mid- and far-field average must match what a lit
  // pane actually shows up close (a room card, ~0.3) or whole facades read as white blocks.
  float glassFarLit = fGlassSkin ? 0.5 : 1.0;
  // Rows line up across neighbors, so this cell's own height in the window gives the band.
  float rowBand = fGlassSkin ? ceilingBand(clamp((p.y - r.z) / (r.w - r.z), 0.0, 1.0)) : 1.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec3 L = cellLight(type, cid + o, fill, seed);
    vec2 q2 = (p - (wc + o * cell)) / (wh + vec2(0.9, 0.8));
    spill += L * exp(-dot(q2, q2) * 2.2);
    vec2 local = p - o * cell;
    float neighborPresent = openCol(fill, cid.x + o.x);
    float aperture = windowCoverage(local, glassRect, footprint) * barTransmission;
    filteredEmit += L * aperture * 0.44 * glassFarLit * rowBand;
    filteredGlass += neighborPresent * aperture;
    filteredMask += neighborPresent * windowCoverage(local, r, footprint);
  }
  spill *= 0.035 * (1.0 - mask);
  spill += lit * col * inten * 0.3 * around;
  avgSpill = openFrac(fill) * min(litRatio, 1.0) * windowColor(0.5) * 1.09 * 0.03;

  // Unlit glass reflects the sky glow; lit glass shows the room.
  vec3 rv = reflect(-vt, vec3(0.0, 0.0, 1.0));
  vec3 refl = skyRefl(vec3(rv.x, rv.y, rv.z)) * (0.04 + 0.5 * pow(1.0 - clamp(vt.z, 0.0, 1.0), 4.0));
  vec3 dark = P_HAZE * 0.05 + refl;
  emit = (mask - frame) * (lit > 0.5 ? inside + refl * 0.5 : dark);
  filteredEmit += filteredGlass * dark;
  float glassFrac = (glassRect.y - glassRect.x) * (glassRect.w - glassRect.z)
                  / (cell.x * cell.y) * barTransmission;
  // Far away a floor is one pixel row: keep each floor group's own tone and brightness.
  vec3 meanLit = (fGlassSkin ? officeColor(cid, s, 0.5) * officeIntensity(cid, s) : mix(windowColor(0.5), OFFICE_WHITE, fOffice.z)) * 0.48;
  avgEmit = openFrac(fill) * glassFrac * (baseRatio * (type == T_RES ? 1.0 : 0.85) * glassFarLit * meanLit + (1.0 - baseRatio) * dark);
}
`;
