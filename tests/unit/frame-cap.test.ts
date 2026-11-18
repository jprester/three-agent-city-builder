import { describe, expect, it } from 'vitest';
import { isGradeName } from '../../src/scene/post';
import { parseFrozenTime } from '../../src/systems/clock';
import { FrameCap, parseFps } from '../../src/systems/frame-cap';
import { isQualityName } from '../../src/systems/quality';

function rate(refresh: number, fps: number, seconds = 10): number {
  const cap = new FrameCap(fps);
  const interval = 1000 / refresh;
  let draws = 0;
  for (let t = 0; t < seconds * 1000; t += interval) {
    if (cap.shouldDraw(t)) draws++;
  }
  return draws / seconds;
}

describe('frame cap', () => {
  it.each([60, 75, 90, 100, 120, 144, 165, 240])('holds 60 fps at %i Hz', (refresh) => {
    const fps = rate(refresh, 60);
    expect(fps).toBeGreaterThan(59);
    expect(fps).toBeLessThan(60.2);
  });

  it.each([60, 75, 90, 120, 144, 240])('holds 30 fps at %i Hz', (refresh) => {
    const fps = rate(refresh, 30);
    expect(fps).toBeGreaterThan(29.5);
    expect(fps).toBeLessThan(30.2);
  });

  it('draws every refresh when uncapped', () => {
    expect(rate(144, 0)).toBeCloseTo(144, 0);
  });

  it('drops a backlog after a long stall instead of bursting', () => {
    const cap = new FrameCap(60);
    for (let t = 0; t < 500; t += 1000 / 144) cap.shouldDraw(t);
    expect(cap.shouldDraw(1500)).toBe(true);
    expect(cap.shouldDraw(1500 + 1000 / 144)).toBe(false);
  });

  it('restarts the schedule when the cap changes', () => {
    const cap = new FrameCap(30);
    expect(cap.shouldDraw(0)).toBe(true);
    expect(cap.shouldDraw(10)).toBe(false);
    cap.setFps(60);
    expect(cap.shouldDraw(10)).toBe(true);
  });
});

describe('URL parameter parsing', () => {
  it('parses frame caps, including uncapped', () => {
    expect(parseFps('60')).toBe(60);
    expect(parseFps('30.5')).toBe(30.5);
    expect(parseFps('0')).toBe(0);
  });

  it('rejects malformed frame caps instead of uncapping', () => {
    for (const value of ['', ' ', 'abc', '-1', 'Infinity', 'NaN']) {
      expect(parseFps(value)).toBeNull();
    }
  });

  it('parses frozen times strictly', () => {
    expect(parseFrozenTime(null)).toBeNull();
    expect(parseFrozenTime('12.5')).toBe(12.5);
    expect(Number.isNaN(parseFrozenTime('12abc'))).toBe(true);
    expect(Number.isNaN(parseFrozenTime(''))).toBe(true);
    expect(Number.isNaN(parseFrozenTime('Infinity'))).toBe(true);
  });

  it('rejects object prototype keys as quality or grade names', () => {
    expect(isQualityName('high')).toBe(true);
    expect(isQualityName('toString')).toBe(false);
    expect(isQualityName('constructor')).toBe(false);
    expect(isQualityName('__proto__')).toBe(false);
    expect(isGradeName('filmic')).toBe(true);
    expect(isGradeName('toString')).toBe(false);
    expect(isGradeName('constructor')).toBe(false);
    expect(isGradeName('__proto__')).toBe(false);
  });
});
