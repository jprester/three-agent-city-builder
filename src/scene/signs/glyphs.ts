/**
 * Stroke glyphs for signs: neon is literally tubes following strokes, so signs are drawn
 * from polylines instead of a font. That keeps the atlas identical on every machine (no
 * system fonts, no font files to license or fetch) and never reproduces real text.
 *
 * Coordinates: glyph box x 0..1, y 0..1 with y DOWN (canvas space).
 */
export type Stroke = [number, number][];
export type Glyph = Stroke[];

type Rng = () => number;

// Latin: a simple monoline alphabet on a 4×6 grid (y up), converted to the unit box.
const L: Record<string, number[][][]> = {
  A: [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 1], [3, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1, 3], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  P: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]]],
  Q: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]], [[2, 2], [4, 0]]],
  R: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[2, 3], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 4], [3, 0], [4, 6]]],
  X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  '0': [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  '1': [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
  '2': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
  '3': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]], [[1, 3], [3, 3]]],
  '4': [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  '5': [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  '6': [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
  '7': [[[0, 6], [4, 6], [1, 0]]],
  '8': [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  '9': [[[4, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  ' ': [],
};

/** Latin glyph in a box `aspect` wide per unit of height (4:6 grid). */
export function latin(ch: string): Glyph {
  return (L[ch] ?? []).map((s) => s.map(([x, y]) => [x / 4, 1 - y / 6] as [number, number]));
}

/** Generic words: trades and services, never names or brands. */
export const WORDS = [
  'HOTEL', 'BAR', 'CAFE', 'NOODLE', 'KARAOKE', 'PAWN', 'CLINIC', 'MAHJONG', 'TAILOR', 'OPTICAL',
  'BAKERY', 'SAUNA', 'DENTAL', 'OPEN 24H', 'HOSTEL', 'TEA', 'DIM SUM', 'GOLD', 'JADE', 'CAMERA',
  'HERBS', 'BILLIARD', 'MASSAGE', 'PHONE', 'WATCH', 'LOANS', 'GUEST', 'ROAST', 'FISH BALL', 'VIDEO',
];

/**
 * Pseudo-CJK character: strokes composed like a real character (a radical beside or above a
 * component, sometimes an enclosure) so it reads as CJK at sign distance, but it is not one.
 */
export function pseudoCjk(rng: Rng): Glyph {
  const strokes: Glyph = [];
  const q = (v: number) => Math.round(v * 8) / 8;
  const comp = (x0: number, y0: number, x1: number, y1: number, n: number) => {
    const w = x1 - x0, h = y1 - y0;
    const X = (t: number) => q(x0 + w * t), Y = (t: number) => q(y0 + h * t);
    for (let i = 0; i < n; i++) {
      const r = rng();
      if (r < 0.28) {
        const y = 0.12 + 0.76 * rng();
        strokes.push([[X(0.05 + 0.1 * rng()), Y(y)], [X(0.9 + 0.1 * rng()), Y(y)]]);
      } else if (r < 0.5) {
        const x = 0.15 + 0.7 * rng();
        strokes.push([[X(x), Y(0.05)], [X(x), Y(0.95)]]);
      } else if (r < 0.64) {
        const a = 0.15 + 0.3 * rng(), b = a + 0.35;
        strokes.push([[X(0.2), Y(a)], [X(0.8), Y(a)], [X(0.8), Y(b)], [X(0.2), Y(b)], [X(0.2), Y(a)]]);
      } else if (r < 0.76) {
        strokes.push([[X(0.55), Y(0.1)], [X(0.45), Y(0.55)], [X(0.1), Y(0.95)]]);
      } else if (r < 0.86) {
        strokes.push([[X(0.4), Y(0.45)], [X(0.65), Y(0.75)], [X(0.95), Y(0.95)]]);
      } else if (r < 0.93) {
        const x = 0.3 + 0.4 * rng(), y = 0.1 + 0.5 * rng();
        strokes.push([[X(x), Y(y)], [X(x + 0.12), Y(y + 0.12)]]);
      } else {
        const x = 0.5 + 0.3 * rng();
        strokes.push([[X(x), Y(0.05)], [X(x), Y(0.9)], [X(x - 0.15), Y(0.8)]]);
      }
    }
  };
  const s = rng();
  if (s < 0.4) {
    const split = 0.3 + 0.12 * rng();
    comp(0.02, 0.02, split, 0.98, 2 + Math.floor(rng() * 2));
    comp(split + 0.06, 0.02, 0.98, 0.98, 3 + Math.floor(rng() * 2));
  } else if (s < 0.72) {
    const split = 0.35 + 0.15 * rng();
    comp(0.05, 0.02, 0.95, split, 2 + Math.floor(rng() * 2));
    comp(0.02, split + 0.06, 0.98, 0.98, 3 + Math.floor(rng() * 2));
  } else if (s < 0.86) {
    strokes.push([[0.08, 0.92], [0.08, 0.06], [0.92, 0.06], [0.92, 0.92]]);
    strokes.push([[0.08, 0.92], [0.92, 0.92]]);
    comp(0.22, 0.2, 0.78, 0.8, 2 + Math.floor(rng() * 2));
  } else {
    comp(0.05, 0.05, 0.95, 0.95, 4 + Math.floor(rng() * 2));
  }
  return strokes;
}

// ---- Pictorial neon icons (idea from the human's earlier future-cityscape project): a trade
// drawn as one or two neon tubes, read instantly at distance. Unit box, y down.
const circle = (cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2, n = 18): [number, number][] =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  });

export const ICONS: Record<string, Glyph> = {
  ramen: [
    [[0.08, 0.55], [0.92, 0.55]],
    circle(0.5, 0.55, 0.42, 0, Math.PI, 14),
    [[0.62, 0.52], [0.95, 0.1]], [[0.7, 0.52], [0.98, 0.18]],
    [[0.32, 0.4], [0.28, 0.3], [0.34, 0.2], [0.3, 0.1]], [[0.46, 0.4], [0.42, 0.3], [0.48, 0.2], [0.44, 0.1]],
  ],
  torii: [
    [[0.02, 0.14], [0.2, 0.2], [0.5, 0.22], [0.8, 0.2], [0.98, 0.14]],
    [[0.12, 0.34], [0.88, 0.34]],
    [[0.24, 0.2], [0.2, 0.98]], [[0.76, 0.2], [0.8, 0.98]], [[0.5, 0.22], [0.5, 0.34]],
  ],
  koi: [
    [[0.1, 0.5], [0.3, 0.3], [0.6, 0.28], [0.78, 0.45], [0.6, 0.62], [0.3, 0.66], [0.1, 0.5]],
    [[0.78, 0.45], [0.98, 0.25], [0.92, 0.48], [0.98, 0.7], [0.78, 0.45]],
    [[0.4, 0.3], [0.5, 0.14], [0.56, 0.29]], circle(0.24, 0.47, 0.035, 0, Math.PI * 2, 8),
  ],
  martini: [
    [[0.1, 0.12], [0.9, 0.12], [0.5, 0.58], [0.1, 0.12]],
    [[0.5, 0.58], [0.5, 0.9]], [[0.3, 0.92], [0.7, 0.92]],
    [[0.62, 0.3], [0.8, 0.05]], circle(0.58, 0.34, 0.06, 0, Math.PI * 2, 10),
  ],
  cat: [
    circle(0.5, 0.55, 0.3, 0, Math.PI * 2, 20),
    [[0.26, 0.38], [0.28, 0.12], [0.44, 0.27]], [[0.56, 0.27], [0.72, 0.12], [0.74, 0.38]],
    [[0.8, 0.5], [0.86, 0.26], [0.95, 0.22]],
    circle(0.4, 0.52, 0.04, 0, Math.PI * 2, 8), circle(0.6, 0.52, 0.04, 0, Math.PI * 2, 8),
  ],
  dice: [
    [[0.14, 0.14], [0.86, 0.14], [0.86, 0.86], [0.14, 0.86], [0.14, 0.14]],
    circle(0.32, 0.32, 0.06, 0, Math.PI * 2, 8), circle(0.5, 0.5, 0.06, 0, Math.PI * 2, 8), circle(0.68, 0.68, 0.06, 0, Math.PI * 2, 8),
  ],
  pill: [
    [[0.3, 0.1], [0.7, 0.1], [0.7, 0.9], [0.3, 0.9], [0.3, 0.1]],
    [[0.5, 0.25], [0.5, 0.75]], [[0.25, 0.5], [0.75, 0.5]],
  ],
};

// Invented brand syllables for tower wordmarks (logo families: one brand on one tower in
// several placements). Short, so stacked vertical versions fit a blade.
const SYL = ['ZEN', 'KOR', 'NEO', 'ONI', 'RYU', 'AKA', 'KAI', 'GEN', 'NEX', 'ION', 'OTO', 'VOL', 'HEX', 'MIRA', 'SHIN', 'DYN'];
export function brandName(rng: () => number): string {
  let a = SYL[Math.floor(rng() * SYL.length)], b = SYL[Math.floor(rng() * SYL.length)];
  if (a === b) b = 'TEK';
  return (a + b).slice(0, 7);
}
