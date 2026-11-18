export const DEFAULT_FPS = 60;
const SLACK_MS = 2;

export function parseFps(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;
  const fps = Number(text);
  return Number.isFinite(fps) && fps >= 0 ? fps : null;
}

export class FrameCap {
  private nextDue = -Infinity;
  private fps: number;

  constructor(fps: number) {
    this.fps = fps;
  }

  setFps(fps: number): void {
    if (fps === this.fps) return;
    this.fps = fps;
    this.nextDue = -Infinity;
  }

  shouldDraw(time: number): boolean {
    if (this.fps <= 0) return true;
    const interval = 1000 / this.fps;
    if (time + SLACK_MS < this.nextDue) return false;
    if (time - this.nextDue > interval) this.nextDue = time;
    this.nextDue += interval;
    return true;
  }
}
