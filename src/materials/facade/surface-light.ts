// End of the surface code: rain-soaked walls, the night's painted light (street and sign
// spill, canyon and city glow, sky rim), daylight, and the inspect grid overlay.
export const SURFACE_LIGHT = /* glsl */ `
// Rain-soaked opaque surfaces: a darker albedo with long vertical runoff, and a sharper
// env response so the practical lights have something to sheen off. Glass and windows keep
// their own reflection model.
if (fType == T_RES || fType == T_OFFICE || fType == T_CAGE || fType == T_TRIM || fType == T_METAL || fType == T_ROOF) {
  float fRunoff = fNoise(vec2(fUv.x * 2.6 + fSeed * 57.0, fUv.y * 0.09));
  float fSoak = fType == T_ROOF ? 0.3 : 0.5;
  fBase *= mix(1.0, 0.92, fSoak * smoothstep(0.35, 0.8, fRunoff));
  fRough = mix(fRough, 0.45, fSoak * 0.55);
}
// Street light spilling up the lower floors: sample the lamp map a little in front of the wall.
vec2 fLampUv = (vFWorld.xz + vFNormal.xz * 2.5 - uLampRect.xy) * uLampRect.zw;
float fLamp = texture2D(uLampMap, fLampUv).r;
fEmit += fBase * P_SODIUM * fLamp * 1.5 * exp(-max(vFWorld.y - 1.0, 0.0) / 7.0);
// Canyon glow: the lit street below (lamp and sign maps, blurred wide) reflects off the wet
// ground and opposite walls and climbs the facades, fading over ~25 m.
vec2 fWideUv = (vFWorld.xz - uLampRect.xy) * uLampRect.zw;
vec3 fStreet = P_SODIUM * texture(uLampMap, fWideUv, 4.5).r * 0.5 + texture(uSignMap, fWideUv, 4.5).rgb * 0.35;
float fUpFacing = fType == T_ROOF ? 0.25 : 1.0;
fWallLight += fStreet * 0.45 * exp(-max(vFWorld.y, 0.0) / 30.0) * fUpFacing;
// City glow: the whole lit city below and the low cloud it lights wash every wall in a warm
// light, strongest near the ground, never gone at the top, so towers read as material
// (stone, concrete, glass) rather than black slabs with windows.
// Pale warm white, not sodium: a sodium wash turned every wall rust-brown.
fWallLight += vec3(1.0, 0.8, 0.62) * uCityGlow * (0.35 + 0.65 * exp(-max(vFWorld.y, 0.0) / 90.0));
// City bounce: a faint warm fill from everything lit around, so walls never go fully black.
fWallLight += mix(P_HAZE * 2.2, P_SODIUM * 0.25, 0.12) * 0.25;
// Sky rim: grazing faces catch the glowing sky, separating silhouettes in depth.
float fRim = pow(1.0 - clamp(fVt.z, 0.0, 1.0), 3.0) * (0.5 + 0.5 * normalize(vFNormal).y + 0.5);
fWallLight += skyRefl(vec3(0.0, 0.05, 0.0)) * fRim * 0.35 + P_HAZE * 0.05;
// Colored light from nearby signs, up to about the height signs hang at.
vec3 fSign = texture2D(uSignMap, (vFWorld.xz + vFNormal.xz * 1.5 - uLampRect.xy) * uLampRect.zw).rgb;
fEmit += fBase * fSign * 0.6 * exp(-max(vFWorld.y - 14.0, 0.0) / 8.0) * smoothstep(0.0, 3.0, vFWorld.y);

if (fType != T_FIXTURE && fType != T_SCREEN) fEmit += fBase * fWallLight;
fEmit *= fType == T_FIXTURE || fType == T_SOFFIT || fType == T_SCREEN || fType == T_DECK ? 1.0 : uWindowGain;
// Daylight (src/scene/daylight.ts): the sun and sky light the city. The night's painted light
// (street and sign spill, city bounce, sky rim) and most lit interiors fade; screens and fixtures
// stay on, dimmer against the day; walls get back the albedo the night took (x0.3-0.6 above).
if (uDay > 0.0) {
  bool fLit = fType == T_FIXTURE || fType == T_SCREEN;
  // Sodium fixtures are the street lamps: off by day.
  bool fStreetLamp = fType == T_FIXTURE && fFill < 0.125 && fTint < 0.15;
  // Glass reflections stay at full strength (fRefl went through the window gain like the rest).
  vec3 fReflOut = fRefl * uWindowGain;
  fEmit = (fEmit - fReflOut) * mix(1.0, fStreetLamp ? 0.03 : fLit ? 0.45 : 0.06, uDay) + fReflOut;
  bool fWallType = fType == T_RES || fType == T_OFFICE || fType == T_CURTAIN || fType == T_PODIUM || fType == T_ROOF
                || fType == T_TRIM || fType == T_CAGE || fType == T_ATLAS || fType == T_SOFFIT || fType == T_DECK;
  fBase *= mix(1.0, fWallType ? 1.9 : 1.0, uDay);
}
// Inspect overlay: floor lines red, bay / cell lines cyan, the module's edges yellow, ~1.5 px.
if (uGridOverlay > 0.5) {
  vec3 fLine = vec3(0.0);
  if (fGridUv.y > -0.5) {
    vec2 g = abs(fract(fGridUv + 0.5) - 0.5) / max(fwidth(fGridUv), vec2(1e-5));
    fLine += vec3(1.0, 0.1, 0.1) * (1.0 - smoothstep(0.75, 1.5, g.y));
    if (fGridUv.x > -0.5) fLine += vec3(0.1, 0.9, 1.0) * (1.0 - smoothstep(0.75, 1.5, g.x));
  }
  if (vFace.y > 0.0) {
    // Bottom and top of the module (the band whose whole floors the fit counts).
    float mv = vFacadeUv.y / vFace.y, w = max(fwidth(mv), 1e-5);
    fLine = mix(fLine, vec3(1.0, 0.85, 0.0), 1.0 - smoothstep(1.0, 2.0, min(abs(mv), abs(mv - 1.0)) / w));
  }
  fEmit = mix(fEmit, fLine * 2.0, step(0.01, dot(fLine, vec3(1.0))));
}
diffuseColor.rgb = fBase;
`;
