/**
 * Quality presets selected with `?quality=low|med|high` (default high). `low` roughly halves
 * the draw calls and triangles of `high`: LOD switches at half distance, a reflection of the
 * signs and sky only (no buildings), fewer bloom levels, no SMAA. Interactive sessions also
 * scale the resolution between `minPixelRatio` and `pixelRatio` with the frame rate
 * (src/systems/dynamic-resolution.ts; `?dynres=0` turns it off).
 */
export interface QualityPreset {
  name: QualityName;
  /** Upper bound on devicePixelRatio. */
  pixelRatio: number;
  /** Lowest pixel ratio dynamic resolution may drop to when frames run slow. */
  minPixelRatio: number;
  /** Planar reflection resolution as a fraction of the canvas. */
  reflectionScale: number;
  /** Buildings, bridges and sign hardware in the ground reflection (signs and sky always). */
  reflectBuildings: boolean;
  bloomLevels: number;
  /** SMAA anti-aliasing pass. */
  smaa: boolean;
  rainCount: number;
  /** Multiplier on LOD switch distances. */
  lodDistanceScale: number;
  /** Share of the layout's traffic that is driven. */
  vehicleDensity: number;
  /** Ray-march steps of the city haze (src/scene/haze.ts), its main per-pixel cost. */
  hazeSteps: number;
}

export type QualityName = 'low' | 'med' | 'high';

export const QUALITY_PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', pixelRatio: 1, minPixelRatio: 0.6, reflectionScale: 0.25, reflectBuildings: false, bloomLevels: 3, smaa: false, rainCount: 4000, lodDistanceScale: 0.5, vehicleDensity: 0.35, hazeSteps: 8 },
  med: { name: 'med', pixelRatio: 1.25, minPixelRatio: 0.75, reflectionScale: 0.25, reflectBuildings: true, bloomLevels: 6, smaa: true, rainCount: 9000, lodDistanceScale: 0.75, vehicleDensity: 0.65, hazeSteps: 10 },
  high: { name: 'high', pixelRatio: 1.5, minPixelRatio: 0.85, reflectionScale: 0.5, reflectBuildings: true, bloomLevels: 8, smaa: true, rainCount: 20000, lodDistanceScale: 1, vehicleDensity: 1, hazeSteps: 12 },
};

export function isQualityName(value: string): value is QualityName {
  return value in QUALITY_PRESETS;
}
