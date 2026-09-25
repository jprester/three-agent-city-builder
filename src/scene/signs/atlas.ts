import * as THREE from 'three';
import { mulberry32 } from '../../../art/layouts/lib/rng.mjs';
import { latin, pseudoCjk, WORDS, type Glyph } from './glyphs';

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
}

export interface SignAtlas {
  texture: THREE.CanvasTexture;
  blades: SignDesign[];
  panels: SignDesign[];
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

  // Blades: 12 × 2 slots of 170 × 512 in the top half.
  for (let row = 0; row < 2; row++) for (let col = 0; col < 12; col++) {
    const x = col * 170, y = row * 512;
    const boxed = rng() < 0.45;
    drawBlade(g, rng, x + GUTTER, y + GUTTER, 170 - 2 * GUTTER, 512 - 2 * GUTTER, boxed);
    blades.push({ kind: 'blade', boxed, rect: rect(x + GUTTER, y + GUTTER, 170 - 2 * GUTTER, 512 - 2 * GUTTER) });
  }
  // Panels: 4 × 8 slots of 512 × 128 in the bottom half.
  for (let row = 0; row < 8; row++) for (let col = 0; col < 4; col++) {
    const x = col * 512, y = 1024 + row * 128;
    const boxed = rng() < 0.6;
    drawPanel(g, rng, x + GUTTER, y + GUTTER, 512 - 2 * GUTTER, 128 - 2 * GUTTER, boxed);
    panels.push({ kind: 'panel', boxed, rect: rect(x + GUTTER, y + GUTTER, 512 - 2 * GUTTER, 128 - 2 * GUTTER) });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return { texture, blades, panels };
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
