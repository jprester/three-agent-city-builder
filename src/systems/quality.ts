/**
 * Quality presets selected with `?quality=low|med|high` (default high). `low` roughly halves
 * the draw calls and triangles of `high`: LOD switches at half distance, a reflection of the
 * signs and sky only (no buildings), fewer bloom levels, no SMAA.
 */
export interface QualityPreset {
  name: QualityName;
  /** Upper bound on devicePixelRatio. */
  pixelRatio: number;
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
}

export type QualityName = 'low' | 'med' | 'high';

export const QUALITY_PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', pixelRatio: 1, reflectionScale: 0.25, reflectBuildings: false, bloomLevels: 3, smaa: false, rainCount: 3000, lodDistanceScale: 0.5, vehicleDensity: 0.35 },
  med: { name: 'med', pixelRatio: 1.25, reflectionScale: 0.25, reflectBuildings: true, bloomLevels: 6, smaa: true, rainCount: 6000, lodDistanceScale: 0.75, vehicleDensity: 0.65 },
  high: { name: 'high', pixelRatio: 1.5, reflectionScale: 0.5, reflectBuildings: true, bloomLevels: 8, smaa: true, rainCount: 12000, lodDistanceScale: 1, vehicleDensity: 1 },
};

export function isQualityName(value: string): value is QualityName {
  return value in QUALITY_PRESETS;
}
