import * as THREE from 'three';
import { mulberry32 } from '../../../art/layouts/lib/rng.mjs';
import { brandName, ICONS, latin, pseudoCjk, WORDS, type Glyph } from './glyphs';

/**
 * Canvas atlas of invented sign faces, drawn once at startup. Channels are data, colored
 * per instance in the sign shader:
 *   R  tube core / ink (strokes)
 *   G  stroke id (random per stroke, 0 = none) for broken and flickering tubes
 *   B  backlit panel area (boxed signs)
 * Glow comes from sampling R at a coarse mip, so every slot has a wide empty gutter.
 */
export interface SignDesign {
  kind: 'blade' | 'panel';
  boxed: boolean;
  /** UV rect: u0, v0, du, dv (v up, as three samples it). */
  rect: THREE.Vector4;
  /** Brand wordmark / stacked logo of brand `brand` (tower logo families). */
  brand?: number;
}

/** Number of invented brands; each gets a vertical logo blade and a wordmark panel. */
export const BRANDS = 8;

export interface SignAtlas {
  texture: THREE.CanvasTexture;
  blades: SignDesign[];
  panels: SignDesign[];
  brandNames: string[];
}

const SIZE = 2048;
const GUTTER = 20;

export function createSignAtlas(seed: number): SignAtlas {
  const rng = mulberry32(seed ^ 0x51a7);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, SIZE, SIZE);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const blades: SignDesign[] = [];
  const panels: SignDesign[] = [];
  const rect = (x: number, y: number, w: number, h: number) =>
    new THREE.Vector4(x / SIZE, 1 - (y + h) / SIZE, w / SIZE, h / SIZE);

  const brandNames = Array.from({ length: BRANDS }, () => brandName(rng));
  const icons = Object.keys(ICONS);
  // Blades: 12 × 2 slots of 170 × 512 in the top half. The last BRANDS slots are stacked
  // brand logos; the first few carry a pictorial neon icon over a caption.
  for (let i = 0; i < 24; i++) {
    const x = (i % 12) * 170, y = Math.floor(i / 12) * 512;
    const [bx, by, bw, bh] = [x + GUTTER, y + GUTTER, 170 - 2 * GUTTER, 512 - 2 * GUTTER];
    const brand = i >= 24 - BRANDS ? i - (24 - BRANDS) : undefined;
    const boxed = brand === undefined && rng() < 0.4;
    if (brand !== undefined) drawStacked(g, rng, brandNames[brand], bx, by, bw, bh);
    else if (i < icons.length) drawPictorial(g, rng, ICONS[icons[i]], bx, by, bw, bh, boxed);
    else drawBlade(g, rng, bx, by, bw, bh, boxed);
    blades.push({ kind: 'blade', boxed, brand, rect: rect(bx, by, bw, bh) });
  }
  // Panels: 4 × 8 slots of 512 × 128 in the bottom half; the last BRANDS are wordmarks.
  for (let i = 0; i < 32; i++) {
    const x = (i % 4) * 512, y = 1024 + Math.floor(i / 4) * 128;
    const [bx, by, bw, bh] = [x + GUTTER, y + GUTTER, 512 - 2 * GUTTER, 128 - 2 * GUTTER];
    const brand = i >= 32 - BRANDS ? i - (32 - BRANDS) : undefined;
    const boxed = brand === undefined && rng() < 0.6;
    if (brand !== undefined) drawWordmark(g, rng, brandNames[brand], bx, by, bw, bh);
    else drawPanel(g, rng, bx, by, bw, bh, boxed);
    panels.push({ kind: 'panel', boxed, brand, rect: rect(bx, by, bw, bh) });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return { texture, blades, panels, brandNames };
}

type Ctx = CanvasRenderingContext2D;

function strokeGlyph(g: Ctx, rng: () => number, glyph: Glyph, x: number, y: number, w: number, h: number, width: number, box: boolean) {
  g.lineWidth = width;
  for (const s of glyph) {
    if (s.length < 2) continue;
    const id = 40 + Math.floor(rng() * 215);
    g.strokeStyle = `rgb(255,${id},${box ? 255 : 0})`;
    g.beginPath();
    s.forEach(([px, py], i) => (i ? g.lineTo(x + px * w, y + py * h) : g.moveTo(x + px * w, y + py * h)));
    g.stroke();
  }
}

function frame(g: Ctx, rng: () => number, x: number, y: number, w: number, h: number, boxed: boolean) {
  if (boxed) {
    g.fillStyle = 'rgb(0,0,255)';
    roundRect(g, x, y, w, h, Math.min(w, h) * 0.08);
    g.fill();
  } else if (rng() < 0.65) {
    // Neon border tube.
    g.lineWidth = Math.min(w, h) * 0.035;
    g.strokeStyle = `rgb(255,${40 + Math.floor(rng() * 215)},0)`;
    roundRect(g, x + g.lineWidth, y + g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth, Math.min(w, h) * 0.12);
    g.stroke();
  }
}

function drawBlade(g: Ctx, rng: () => number, x: number, y: number, w: number, h: number, boxed: boolean) {
  frame(g, rng, x, y, w, h, boxed);
  const n = 2 + Math.floor(rng() * 4);
  const pad = w * 0.18;
  const cell = Math.min(w - 2 * pad, (h - 2 * pad) / n);
  const top = y + (h - cell * n) / 2;
  for (let i = 0; i < n; i++) {
    strokeGlyph(g, rng, pseudoCjk(rng), x + (w - cell) / 2 + cell * 0.08, top + i * cell + cell * 0.08, cell * 0.84, cell * 0.84, cell * (boxed ? 0.1 : 0.075), boxed);
  }
}

function drawPanel(g: Ctx, rng: () => number, x: number, y: number, w: number, h: number, boxed: boolean) {
  frame(g, rng, x, y, w, h, boxed);
  const pad = h * 0.18;
  if (rng() < 0.45) {
    const word = WORDS[Math.floor(rng() * WORDS.length)];
    const ch = h - 2 * pad;
    const cw = Math.min(ch * 0.62, (w - 2 * pad) / word.length);
    const left = x + (w - cw * word.length) / 2;
    [...word].forEach((c, i) => strokeGlyph(g, rng, latin(c), left + i * cw + cw * 0.15, y + pad, cw * 0.7, ch, ch * (boxed ? 0.11 : 0.08), boxed));
  } else {
    const n = 2 + Math.floor(rng() * 4);
    const cell = Math.min(h - 2 * pad, (w - 2 * pad) / n);
    const left = x + (w - cell * n) / 2;
    for (let i = 0; i < n; i++) {
      strokeGlyph(g, rng, pseudoCjk(rng), left + i * cell + cell * 0.08, y + (h - cell) / 2 + cell * 0.08, cell * 0.84, cell * 0.84, cell * (boxed ? 0.1 : 0.075), boxed);
    }
  }
}

function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawPictorial(g: Ctx, rng: () => number, icon: Glyph, x: number, y: number, w: number, h: number, boxed: boolean) {
  frame(g, rng, x, y, w, h, boxed);
  const pad = w * 0.14, iw = w - 2 * pad;
  strokeGlyph(g, rng, icon, x + pad, y + pad * 1.5, iw, iw, w * 0.05, boxed);
  const n = 2 + Math.floor(rng() * 2);
  const top = y + pad * 2 + iw, cell = Math.min(iw * 0.75, (h - (top - y) - pad) / n);
  for (let i = 0; i < n; i++) {
    strokeGlyph(g, rng, pseudoCjk(rng), x + (w - cell) / 2, top + i * cell + cell * 0.1, cell * 0.8, cell * 0.8, cell * 0.08, boxed);
  }
}

/** Brand name, letters stacked vertically inside a tube border (the tower's corner logo). */
function drawStacked(g: Ctx, rng: () => number, name: string, x: number, y: number, w: number, h: number) {
  g.lineWidth = w * 0.035;
  g.strokeStyle = `rgb(255,${40 + Math.floor(rng() * 215)},0)`;
  roundRect(g, x + 4, y + 4, w - 8, h - 8, w * 0.2);
  g.stroke();
  const cell = Math.min((h - 30) / name.length, w * 0.9);
  const cw = cell * 0.62, top = y + (h - cell * name.length) / 2;
  [...name].forEach((c, i) => strokeGlyph(g, rng, latin(c), x + (w - cw) / 2, top + i * cell + cell * 0.12, cw, cell * 0.76, cell * 0.09, false));
}

/** Brand wordmark: widely tracked letters with an underline tube (the tower crown sign). */
function drawWordmark(g: Ctx, rng: () => number, name: string, x: number, y: number, w: number, h: number) {
  const ch = h * 0.62, track = Math.min(ch * 0.95, (w - 20) / name.length);
  const cw = ch * 0.62, left = x + (w - track * name.length) / 2 + (track - cw) / 2;
  [...name].forEach((c, i) => strokeGlyph(g, rng, latin(c), left + i * track, y + h * 0.08, cw, ch, ch * 0.1, false));
  g.lineWidth = h * 0.05;
  g.strokeStyle = `rgb(255,${40 + Math.floor(rng() * 215)},0)`;
  g.beginPath();
  g.moveTo(x + w * 0.15, y + h * 0.88);
  g.lineTo(x + w * 0.85, y + h * 0.88);
  g.stroke();
}
