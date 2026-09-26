import * as THREE from 'three';
import palette from '../../art/style/palette.json';
import { mulberry32 } from '../../art/layouts/lib/rng.mjs';
import { latin, pseudoCjk, WORDS, type Glyph } from './signs/glyphs';

/**
 * Atlas of invented video-screen "posters", drawn once on a canvas (no fonts, no network,
 * no real brands or people): gradient backdrops in the sign palette, an abstract main
 * motif (a stylised portrait silhouette, a product shape, rings or a giant character),
 * and stroke-glyph text. The facade shader cycles screens through these.
 *
 * Layout: COLS × ROWS portrait slots of SLOT_W × SLOT_H px, uniform grid, so the shader can
 * address slot i directly.
 */
export const SCREEN_COLS = 8;
export const SCREEN_ROWS = 4;
const SLOT_W = 256, SLOT_H = 512;

const P = palette as Record<string, string>;
// Backdrop pairs: saturated key color into a deep one. Cyan stays rare (style bible).
const SCHEMES: [string, string, string][] = [
  [P.sign_red, '#2a0610', P.tungsten],
  [P.sign_amber, '#3a1606', P.fluorescent],
  [P.tv_blue, '#070c2a', P.sign_amber],
  ['#b0203c', '#12040c', P.sign_amber],
  [P.sign_red, '#1a0a24', P.fluorescent],
  [P.sodium, '#200808', P.tv_blue],
  [P.sign_cyan, '#04161c', P.sign_red],
  ['#6b3fd0', '#0c0620', P.sign_amber],
];

export function createScreenAtlas(seed: number): THREE.CanvasTexture {
  const rng = mulberry32(seed ^ 0x5c4ee7);
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_COLS * SLOT_W;
  canvas.height = SCREEN_ROWS * SLOT_H;
  const g = canvas.getContext('2d')!;
  for (let i = 0; i < SCREEN_COLS * SCREEN_ROWS; i++) {
    const x = (i % SCREEN_COLS) * SLOT_W, y = Math.floor(i / SCREEN_COLS) * SLOT_H;
    g.save();
    g.beginPath();
    g.rect(x, y, SLOT_W, SLOT_H);
    g.clip();
    drawPoster(g, rng, x, y, SCHEMES[i % SCHEMES.length], i);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

type Ctx = CanvasRenderingContext2D;

function drawPoster(g: Ctx, rng: () => number, x: number, y: number, [key, deep, accent]: [string, string, string], i: number) {
  const W = SLOT_W, H = SLOT_H;
  const bg = g.createLinearGradient(x, y, x + W * (rng() - 0.5), y + H);
  bg.addColorStop(0, rng() < 0.5 ? key : deep);
  bg.addColorStop(1, rng() < 0.5 ? deep : key);
  g.fillStyle = bg;
  g.fillRect(x, y, W, H);
  // Soft light blooms in the backdrop.
  for (let k = 0; k < 3; k++) {
    const cx = x + W * rng(), cy = y + H * rng(), r = W * (0.3 + 0.6 * rng());
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, withAlpha(k === 0 ? accent : key, 0.45));
    rg.addColorStop(1, withAlpha(key, 0));
    g.fillStyle = rg;
    g.fillRect(x, y, W, H);
  }

  const motif = i % 4;
  if (motif === 0) portrait(g, rng, x, y, key, accent);
  else if (motif === 1) product(g, rng, x, y, accent);
  else if (motif === 2) rings(g, rng, x, y, accent);
  else bigChar(g, rng, x, y, accent);

  // Text: a pseudo-CJK column down one side and a Latin word along the bottom.
  const colX = rng() < 0.5 ? x + 16 : x + W - 52;
  g.lineCap = g.lineJoin = 'round';
  for (let k = 0; k < 4; k++) drawGlyph(g, pseudoCjk(rng), colX, y + 40 + k * 44, 36, 36, 4, '#ffffff');
  const word = WORDS[Math.floor(rng() * WORDS.length)].slice(0, 7);
  const cw = Math.min(28, (W - 40) / word.length);
  const bandY = y + H - 70;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(x, bandY - 10, W, 60);
  [...word].forEach((c, k) => drawGlyph(g, latin(c), x + (W - cw * word.length) / 2 + k * cw + 3, bandY, cw * 0.72, 40, 4.5, accent));
}

function portrait(g: Ctx, rng: () => number, x: number, y: number, key: string, accent: string) {
  // Stylised head-and-shoulders silhouette with a colored rim light: reads as "a person on
  // a billboard" from a distance without depicting anyone.
  const cx = x + SLOT_W * (0.45 + 0.15 * rng()), cy = y + SLOT_H * 0.46;
  g.fillStyle = 'rgba(10,8,14,0.92)';
  g.beginPath();
  g.ellipse(cx, cy, 58, 74, 0.08 * (rng() - 0.5), 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(cx - 150, y + SLOT_H);
  g.quadraticCurveTo(cx - 110, cy + 110, cx - 26, cy + 70);
  g.lineTo(cx + 26, cy + 70);
  g.quadraticCurveTo(cx + 110, cy + 110, cx + 150, y + SLOT_H);
  g.fill();
  // Hair shape and rim light.
  g.beginPath();
  g.ellipse(cx - 6, cy - 34, 66, 52, -0.2, Math.PI * 0.9, Math.PI * 2.1);
  g.fill();
  g.strokeStyle = accent;
  g.lineWidth = 5;
  g.shadowColor = accent;
  g.shadowBlur = 18;
  g.beginPath();
  g.ellipse(cx, cy, 58, 74, 0, -Math.PI * 0.45, Math.PI * 0.35);
  g.stroke();
  g.shadowBlur = 0;
  void key;
}

function product(g: Ctx, rng: () => number, x: number, y: number, accent: string) {
  // A can or bottle shape with a label band and highlight.
  const cx = x + SLOT_W * 0.55, top = y + SLOT_H * 0.2, w = 70 + 30 * rng(), h = 230;
  const bottle = rng() < 0.5;
  g.fillStyle = 'rgba(245,240,230,0.92)';
  g.beginPath();
  if (bottle) {
    g.moveTo(cx - 14, top); g.lineTo(cx + 14, top); g.lineTo(cx + 14, top + 40);
    g.quadraticCurveTo(cx + w / 2, top + 70, cx + w / 2, top + 110);
    g.lineTo(cx + w / 2, top + h); g.lineTo(cx - w / 2, top + h); g.lineTo(cx - w / 2, top + 110);
    g.quadraticCurveTo(cx - w / 2, top + 70, cx - 14, top + 40);
  } else {
    g.roundRect(cx - w / 2, top + 40, w, h - 40, 16);
  }
  g.fill();
  g.fillStyle = accent;
  g.fillRect(cx - w / 2, top + h * 0.55, w, 50);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillRect(cx - w / 2 + 10, top + 60, 8, h - 90);
}

function rings(g: Ctx, rng: () => number, x: number, y: number, accent: string) {
  const cx = x + SLOT_W * 0.5, cy = y + SLOT_H * (0.35 + 0.1 * rng());
  g.shadowColor = accent;
  g.shadowBlur = 14;
  for (let k = 0; k < 4; k++) {
    g.strokeStyle = k % 2 ? accent : '#ffffff';
    g.lineWidth = 8 - k;
    g.beginPath();
    g.arc(cx, cy, 30 + k * 26, rng() * Math.PI, rng() * Math.PI + Math.PI * (1 + rng()));
    g.stroke();
  }
  g.shadowBlur = 0;
}

function bigChar(g: Ctx, rng: () => number, x: number, y: number, accent: string) {
  g.lineCap = g.lineJoin = 'round';
  g.shadowColor = accent;
  g.shadowBlur = 16;
  drawGlyph(g, pseudoCjk(rng), x + 48, y + 90, 170, 170, 14, '#ffffff');
  g.shadowBlur = 0;
}

function drawGlyph(g: Ctx, glyph: Glyph, x: number, y: number, w: number, h: number, width: number, color: string) {
  g.strokeStyle = color;
  g.lineWidth = width;
  for (const s of glyph) {
    if (s.length < 2) continue;
    g.beginPath();
    s.forEach(([px, py], k) => (k ? g.lineTo(x + px * w, y + py * h) : g.moveTo(x + px * w, y + py * h)));
    g.stroke();
  }
}

function withAlpha(hex: string, a: number) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}
