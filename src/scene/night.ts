/**
 * Slow changes over the night, as pure functions of the shared clock (frozen-time renders stay
 * reproducible; all three are at their usual values around t = 12, where the shots are taken).
 *  night  0 → 1 → 0 over NIGHT seconds: lit windows and small shops switch off as it deepens,
 *         then it eases back, so a long session never ends up dark.
 *  rain   rain comes in waves: the share of falling streaks and of puddle ripples, 0.35–1.
 *  fog    fog density factor, ±18 %.
 */
const NIGHT = 1200;
const RAIN = 180;
const FOG = 240;

export function nightAt(time: number): { night: number; rain: number; fog: number } {
  const night = 0.5 - 0.5 * Math.cos((2 * Math.PI * time) / NIGHT);
  const wave = 0.5 + 0.5 * Math.cos((2 * Math.PI * time) / RAIN);
  const rain = 0.35 + 0.65 * wave * wave * (3 - 2 * wave);
  const fog = 1 + 0.18 * Math.sin((2 * Math.PI * time) / FOG);
  return { night, rain, fog };
}
