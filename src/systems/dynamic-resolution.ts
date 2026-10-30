/**
 * Dynamic resolution: the frame is fill-rate bound (street-level facades and post passes cost
 * per pixel), so when frames run slow the render pixel ratio steps down, and it steps back up
 * once frames are comfortably fast again. Frame times are smoothed; spikes (a hidden tab, a
 * shader compile) are ignored. A step up that has to be undone soon after doubles the wait
 * before the next try, so a scene right at the limit settles instead of flickering between two
 * resolutions (every change reallocates the render targets, a small hitch).
 */
export interface DynamicResolutionOptions {
  /** Highest pixel ratio (the preset's). */
  max: number;
  /** Lowest pixel ratio it may drop to. */
  min: number;
  /** Ratio change per step. */
  step?: number;
  /** Step down when the smoothed frame time exceeds this (ms). */
  slowMs?: number;
  /** Step up after `holdUp` seconds below this (ms). */
  fastMs?: number;
  holdUp?: number;
}

export class DynamicResolution {
  ratio: number;
  private avg = 0;
  private fastSince = -1;
  private slowSince = -1;
  private lastDown = -Infinity;
  private lastUp = -Infinity;
  private upDelay = 4;
  private readonly o: Required<DynamicResolutionOptions>;

  constructor(options: DynamicResolutionOptions, private readonly apply: (ratio: number) => void) {
    this.o = { step: 0.125, slowMs: 1000 / 48, fastMs: 1000 / 58, holdUp: 3, ...options };
    this.ratio = options.max;
  }

  /** Call once per frame with the real time (s) and the real frame interval (ms). */
  update(now: number, frameMs: number) {
    const o = this.o;
    // Over a second: a paused or hidden tab, not a measurement. Slow frames up to that count
    // (capped), so a sustained crawl, e.g. a GPU paging under memory pressure, still steps down.
    if (!(frameMs > 0) || frameMs > 1000) return;
    const ms = Math.min(frameMs, 250);
    this.avg = this.avg === 0 ? ms : this.avg + (ms - this.avg) * 0.08;
    // Slow for half a second, not one hitch: a single long frame decays out of the average sooner.
    if (this.avg > o.slowMs) { if (this.slowSince < 0) this.slowSince = now; } else this.slowSince = -1;
    if (this.slowSince >= 0 && now - this.slowSince > 0.5 && this.ratio > o.min && now - Math.max(this.lastDown, this.lastUp) > 0.75) {
      // Undoing a recent step up: wait longer before the next try.
      this.upDelay = now - this.lastUp < 2 ? Math.min(this.upDelay * 2, 30) : 4;
      this.set(this.ratio - o.step);
      this.lastDown = now;
      this.fastSince = -1;
      this.slowSince = -1;
      this.avg = 0;   // re-measure at the new resolution
      return;
    }
    if (this.avg < o.fastMs) {
      if (this.fastSince < 0) this.fastSince = now;
      if (this.ratio < o.max && now - this.fastSince > o.holdUp && now - this.lastDown > this.upDelay) {
        this.set(this.ratio + o.step);
        this.lastUp = now;
        this.fastSince = -1;
        this.avg = 0;
      }
    } else {
      this.fastSince = -1;
    }
  }

  private set(r: number) {
    const next = Math.min(this.o.max, Math.max(this.o.min, Math.round(r * 1000) / 1000));
    if (next === this.ratio) return;
    this.ratio = next;
    this.apply(next);
  }
}
