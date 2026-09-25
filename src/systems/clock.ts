/**
 * The one clock everything time-based reads. `?t=<seconds>` freezes it, so
 * screenshots of animated scenes are reproducible.
 */
export class Clock {
  /** Shared shader uniform; pass it by reference into materials. */
  readonly uniform = { value: 0 };
  private readonly start = performance.now();

  constructor(readonly frozenAt: number | null) {
    this.uniform.value = frozenAt ?? 0;
  }

  get frozen(): boolean {
    return this.frozenAt !== null;
  }

  /** Advance to the current time (no-op when frozen) and return it in seconds. */
  tick(): number {
    this.uniform.value = this.frozenAt ?? (performance.now() - this.start) / 1000;
    return this.uniform.value;
  }

  get time(): number {
    return this.uniform.value;
  }
}

/** Parses `?t=`. Returns null (running clock) when absent, NaN when malformed. */
export function parseFrozenTime(value: string | null): number | null {
  if (value === null) return null;
  const t = Number.parseFloat(value);
  return Number.isFinite(t) ? t : Number.NaN;
}
