/**
 * Distant lightning in the rain clouds, as a pure function of the shared clock (frozen-time
 * renders stay reproducible). Time is cut into EPOCH-second slots; in most slots one strike
 * flickers a few times over about a second, from its own direction. Returns the flash
 * strength (0 when quiet, ~1 at a peak) and the strike's horizontal direction.
 */
const EPOCH = 40;

function hash(n: number) {
  return Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
}

export function lightningAt(time: number): { flash: number; dir: [number, number] } {
  const epoch = Math.floor(time / EPOCH);
  const az = hash(epoch + 0.37) * Math.PI * 2;
  const dir: [number, number] = [Math.cos(az), Math.sin(az)];
  if (hash(epoch + 0.71) > 0.75) return { flash: 0, dir };          // a quiet slot
  const dt = time - (epoch * EPOCH + 6 + hash(epoch) * (EPOCH - 12));
  if (dt < 0 || dt > 1.4) return { flash: 0, dir };
  // A bright first stroke and one or two weaker re-strikes.
  const pulse = (t0: number, amp: number, k: number) => (dt >= t0 ? amp * Math.exp(-(dt - t0) * k) : 0);
  const flash = pulse(0, 1, 13) + pulse(0.2, 0.65, 10) + (hash(epoch + 0.13) > 0.5 ? pulse(0.55, 0.4, 9) : 0);
  return { flash: Math.min(flash, 1.2), dir };
}
