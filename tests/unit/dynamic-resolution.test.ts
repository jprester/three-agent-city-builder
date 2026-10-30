import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../../src/systems/dynamic-resolution';

/** Runs `secs` of frames at `ms` each, starting at time t; returns the end time. */
function run(d: DynamicResolution, t: number, secs: number, ms: number) {
  for (let s = 0; s < secs; s += ms / 1000) d.update(t + s, ms);
  return t + secs;
}

describe('dynamic resolution', () => {
  it('steps down while frames are slow, never below the minimum', () => {
    const applied: number[] = [];
    const d = new DynamicResolution({ max: 1.5, min: 0.85 }, (r) => applied.push(r));
    run(d, 0, 20, 30);
    expect(d.ratio).toBe(0.85);
    expect(applied[0]).toBe(1.375);
    expect(Math.min(...applied)).toBeGreaterThanOrEqual(0.85);
  });

  it('steps back up once frames are fast, after a hold', () => {
    const d = new DynamicResolution({ max: 1.5, min: 0.85 }, () => {});
    let t = run(d, 0, 2, 30);
    const low = d.ratio;
    expect(low).toBeLessThan(1.5);
    t = run(d, t, 2, 10);
    expect(d.ratio).toBe(low);   // still holding
    run(d, t, 60, 10);
    expect(d.ratio).toBe(1.5);
  });

  it('settles at the limit instead of flickering', () => {
    // Fast below ratio 1.25, slow above it.
    let ratio = 1.5;
    let changes = 0;
    const d = new DynamicResolution({ max: 1.5, min: 0.85 }, (r) => { ratio = r; changes++; });
    let t = 0;
    for (let k = 0; k < 120 * 60; k++) {
      const ms = ratio > 1.25 ? 24 : 12;
      d.update(t, ms);
      t += ms / 1000;
    }
    // Two minutes: a handful of retries with growing waits, not one every few seconds.
    expect(changes).toBeLessThan(16);
    expect(d.ratio).toBeLessThanOrEqual(1.375);
  });

  it('ignores pauses and spikes', () => {
    const d = new DynamicResolution({ max: 1.5, min: 0.85 }, () => {});
    run(d, 0, 5, 12);
    d.update(5.1, 5000);   // tab was hidden
    d.update(5.2, 400);
    run(d, 5.3, 1, 12);
    expect(d.ratio).toBe(1.5);
  });
});
