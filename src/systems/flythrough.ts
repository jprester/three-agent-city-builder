import * as THREE from 'three';
import type { Layout } from './layout';

type Spline = NonNullable<Layout['flythrough']>;

/**
 * Camera speed in m/s at a given height. Proportional to altitude so the apparent motion stays
 * about constant: a slow drift through the canyon, a fast sweep over the skyline. Continuous
 * in height, so speed eases in and out wherever the path climbs or descends.
 */
export const FLY_SPEED = { base: 4, perMeter: 0.17, min: 7.5, max: 48 };

export function speedAt(y: number): number {
  return THREE.MathUtils.clamp(FLY_SPEED.base + FLY_SPEED.perMeter * y, FLY_SPEED.min, FLY_SPEED.max);
}

/** Distance in meters ahead along the tangent that the camera looks at, without a look track. */
const LOOK_AHEAD = 20;
/** Arc-length samples of the timing table. */
const SAMPLES = 4000;

/**
 * The cinematic flythrough as a function of time: position along the layout's spline at the
 * altitude-dependent speed, look target from the layout's look track (same parameterization).
 * Pure: the same time always gives the same frame, so `?t=` renders are reproducible.
 */
export class FlythroughPath {
  readonly duration: number;
  readonly closed: boolean;
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly look: THREE.CatmullRomCurve3 | null;
  /** times[k]: seconds to reach arc-length fraction k / SAMPLES. */
  private readonly times = new Float64Array(SAMPLES + 1);

  constructor(spline: Spline) {
    this.closed = spline.closed ?? true;
    this.curve = new THREE.CatmullRomCurve3(spline.points.map((p) => new THREE.Vector3(...p)), this.closed);
    this.curve.arcLengthDivisions = SAMPLES;
    this.look = spline.look?.length === spline.points.length
      ? new THREE.CatmullRomCurve3(spline.look.map((p) => new THREE.Vector3(...p)), this.closed)
      : null;
    const pts = this.curve.getSpacedPoints(SAMPLES);
    for (let k = 1; k <= SAMPLES; k++) {
      const ds = pts[k].distanceTo(pts[k - 1]);
      this.times[k] = this.times[k - 1] + ds / speedAt((pts[k].y + pts[k - 1].y) / 2);
    }
    this.duration = this.times[SAMPLES];
  }

  static from(layout: Layout | null): FlythroughPath | null {
    const s = layout?.flythrough;
    return s && s.points.length >= 2 ? new FlythroughPath(s) : null;
  }

  /** Arc-length fraction (0..1) reached `time` seconds into the loop. */
  fractionAt(time: number): number {
    const D = this.duration;
    const t = this.closed ? ((time % D) + D) % D : THREE.MathUtils.clamp(time, 0, D);
    let lo = 0, hi = SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= t) lo = mid; else hi = mid;
    }
    const span = this.times[hi] - this.times[lo];
    return (lo + (span > 0 ? (t - this.times[lo]) / span : 0)) / SAMPLES;
  }

  /** Camera position and look target `time` seconds into the loop. */
  sample(time: number, position: THREE.Vector3, target: THREE.Vector3): void {
    this.sampleAt(this.fractionAt(time), position, target);
  }

  /** Camera position and look target at arc-length fraction u. */
  sampleAt(u: number, position: THREE.Vector3, target: THREE.Vector3): void {
    this.curve.getPointAt(u, position);
    if (this.look) this.look.getPoint(this.curve.getUtoTmapping(u, 0), target);
    else target.copy(position).addScaledVector(this.curve.getTangentAt(u), LOOK_AHEAD);
  }
}
