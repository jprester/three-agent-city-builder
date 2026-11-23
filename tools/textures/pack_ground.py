"""Street materials for the ground shader (src/materials/ground.ts GROUND_SURFACES).

    python3 tools/textures/pack_ground.py        then: npm run textures

Sources, art/external/textures/ground/<name>.webp (+ <name>-normal.webp, <name>-height.webp):
seamless tiles made with Z-Image Turbo (`img "<prompt>" --tile -s <seed>`) and DeepBump
(`texmaps <name>.png`); prompts and seeds in ground.def.json beside them.

Writes art/textures/ground/<name>_albedo.webp: the colour with its overall tint removed and each
channel scaled to a linear mean of 0.18 (the shader multiplies the palette colour by albedo /
0.18, so the palette stays in charge), height in alpha (0.5 mean); and <name>_normal.webp.
Normal and height are high-passed (periodic Gaussian, `highpass` px): DeepBump leaves a broad
tilt across the tile, which would shade every repeat the same way and show the tiling.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'art' / 'external' / 'textures' / 'ground'
OUT = ROOT / 'art' / 'textures' / 'ground'
SIZE = 1024


def load(path, mode):
    im = Image.open(path).convert(mode)
    return im.resize((SIZE, SIZE), Image.LANCZOS) if im.size != (SIZE, SIZE) else im


def to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(l):
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.maximum(l, 0), 1 / 2.4) - 0.055)


def blur(a, sigma):
    """Periodic Gaussian blur (the tiles are seamless, so wrap-around is exact)."""
    f = np.fft.fftfreq(a.shape[0])[:, None] ** 2 + np.fft.fftfreq(a.shape[1])[None, :] ** 2
    k = np.exp(-2 * (np.pi * sigma) ** 2 * f)
    return np.real(np.fft.ifft2(np.fft.fft2(a, axes=(0, 1)) * (k[..., None] if a.ndim == 3 else k), axes=(0, 1)))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for s in json.loads((SRC / 'ground.def.json').read_text())['surfaces']:
        name = s['name']
        rgb = to_linear(np.asarray(load(SRC / f'{name}.webp', 'RGB'), np.float32) / 255)
        rgb *= 0.18 / rgb.reshape(-1, 3).mean(0)
        hp = s.get('highpass', 48)
        h = np.asarray(load(SRC / f'{name}-height.webp', 'L'), np.float32) / 255
        h = h - blur(h, hp)
        h = np.clip(0.5 + (h - h.mean()) / (4 * h.std() + 1e-6), 0, 1)
        a = np.dstack([to_srgb(np.clip(rgb, 0, 1)), h])
        Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGBA').save(OUT / f'{name}_albedo.webp', lossless=True)
        n = np.asarray(load(SRC / f'{name}-normal.webp', 'RGB'), np.float32) / 127.5 - 1
        xy = n[..., :2] - blur(n[..., :2], hp)
        n = np.dstack([xy, np.sqrt(np.clip(1 - (xy ** 2).sum(-1), 0.05, 1))])
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        Image.fromarray(((n + 1) * 127.5 + 0.5).clip(0, 255).astype(np.uint8), 'RGB').save(OUT / f'{name}_normal.webp', lossless=True)
        clip = (rgb > 1).mean()
        print(f'{name}: albedo + height, normal -> art/textures/ground/ ({clip:.1%} clipped)')


if __name__ == '__main__':
    main()
