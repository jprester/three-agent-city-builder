/**
 * Quality presets selected with `?quality=low|med|high` (default high).
 * Only pixelRatio is consumed so far; the rest are read by the systems that
 * land in later phases, and get tuned in phase 8 (low ≈ half of high).
 */
export interface QualityPreset {
  name: QualityName;
  /** Upper bound on devicePixelRatio. */
  pixelRatio: number;
  /** Planar reflection resolution as a fraction of the canvas. */
  reflectionScale: number;
  bloomLevels: number;
  rainCount: number;
  signCount: number;
  /** Multiplier on LOD switch distances. */
  lodDistanceScale: number;
}

export type QualityName = 'low' | 'med' | 'high';

export const QUALITY_PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', pixelRatio: 1, reflectionScale: 0.25, bloomLevels: 4, rainCount: 3000, signCount: 80, lodDistanceScale: 0.5 },
  med: { name: 'med', pixelRatio: 1.25, reflectionScale: 0.25, bloomLevels: 6, rainCount: 6000, signCount: 140, lodDistanceScale: 0.75 },
  high: { name: 'high', pixelRatio: 1.5, reflectionScale: 0.5, bloomLevels: 8, rainCount: 12000, signCount: 220, lodDistanceScale: 1 },
};

export function isQualityName(value: string): value is QualityName {
  return value in QUALITY_PRESETS;
}
