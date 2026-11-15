"""Emissive and roughness maps that match their facade photos, for the tower bundles whose
generated maps do not: writes art/external/textures/<bundle>/emissive_fixed.webp and, for osaka,
diffuse_rough_fixed.webp (the photo unchanged, its roughness corrected); the KTX2 build reads
them (art/textures/ktx2.def.json); the source files stay as imported.

  python3 tools/textures/fix_emissive.py

The bundles were generated texture by texture, and the emissive did not always come out as the
same building as the diffuse photo (docs/NOTES.md, "Facade emissive"):
  osaka       the emissive (B_fixed: A was truncated in the source) shows other windows: lit
              rooms land on spandrels and piers, and its window mask is not this building either
              (osaka 3). Rebuilt from the photo's own windows on its verified grid
              (<bundle>.json): a window is where the photo has mullion edges across a floor and
              sill edges across a bay; rooms lit per floor and bay, warm or cool, with the
              photo's own window texture as interior detail.
  glass_sky   the emissive matches its windows but also lights the white piers in thin lines:
              masked off where the photo is a bright, unsaturated pier.
  osaka's roughness (diffuse_rough.webp alpha) marks the same wrong blobs as smooth glass, so
              the glass reflection drew them on the walls: capped at glossy glass (0.3) inside the
              rebuilt windows, floored at matte wall (0.65) outside them.
  real_glass  matches; untouched (no fixed file).
Deterministic: same inputs, same bytes.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

TEX = Path(__file__).resolve().parents[2] / "art" / "external" / "textures"
LIT_SHARE = 0.34                 # share of floor x bay cells lit in the rebuilt osaka emissive
WARM = np.array([1.0, 0.80, 0.56])   # tungsten-lit room (linear-ish, scaled below)
COOL = np.array([0.86, 0.92, 1.0])   # fluorescent office


def _load(path, mode):
    return np.asarray(Image.open(path).convert(mode), dtype=np.float32) / 255.0


def _band(profile, frac, bins=32):
    """1 where the profile, folded by `frac` (position within a floor or bay, 0-1), is in its
    upper half (above 45 % of its range, smoothed over 5 of 32 bins); 0 elsewhere."""
    k = np.minimum((frac * bins).astype(int), bins - 1)
    prof = np.array([profile[k == b].mean() if np.any(k == b) else 0.0 for b in range(bins)])
    prof = np.convolve(np.concatenate([prof[-2:], prof, prof[:2]]), np.ones(5) / 5, mode="valid")
    return (prof > prof.min() + 0.45 * (prof.max() - prof.min())).astype(np.float32)[k]


def rebuild(name):
    """New emissive for every facade of the bundle, from its photo and grid."""
    rgba = _load(TEX / name / "diffuse_rough.webp", "RGBA")
    lum = rgba[..., :3].mean(axis=2)
    H, W = lum.shape
    out = np.zeros((H, W, 3), dtype=np.float32)
    windows = np.zeros((H, W), dtype=np.float32)
    spec = json.loads((TEX / f"{name}.json").read_text())
    for i, f in enumerate(spec["facades"]):
        rng = np.random.default_rng(1000 + i)
        x0, y0, x1, y1 = (round(f["rect"][0] * W), round(f["rect"][1] * H), round(f["rect"][2] * W), round(f["rect"][3] * H))
        # Floor and bay index of every texel, counted from the grid's lines (y down).
        floor, bay = f["floor"] * H, f["bay"] * W
        gx0, gy1 = f["grid"][0] * W, f["grid"][3] * H
        ys, xs = np.arange(y0, y1), np.arange(x0, x1)
        fi = np.floor((gy1 - ys) / floor).astype(int)
        bi = np.floor((xs - gx0) / bay).astype(int)
        fy = ((gy1 - ys) / floor) % 1.0                       # 0 at a floor line, rising
        fu, bu = np.unique(fi), np.unique(bi)
        on = rng.random((len(fu), len(bu))) < LIT_SHARE
        warm = rng.random((len(fu), len(bu))) < 0.6
        gain = rng.uniform(0.55, 1.0, (len(fu), len(bu)))
        cell_col = np.where(warm[..., None], WARM, COOL) * gain[..., None] * on[..., None]
        fidx = np.searchsorted(fu, fi)[:, None]
        bidx = np.searchsorted(bu, bi)[None, :]
        col = cell_col[fidx, bidx]
        # The window shape from the photo itself, on its verified grid (the source window mask
        # does not depict this building on every facade): a floor's window band is where the
        # photo has vertical edges (mullions, frames; spandrels and slabs are flat across), a
        # bay's window span where it has horizontal edges (sills, transoms; piers are flat up).
        # Both folded over every floor and bay; a window is in both.
        fx = ((xs - gx0) / bay) % 1.0
        win_lum = lum[y0:y1, x0:x1]
        m = _band(np.abs(np.diff(win_lum, axis=1, prepend=win_lum[:, :1])).mean(axis=1), fy)[:, None] \
            * _band(np.abs(np.diff(win_lum, axis=0, prepend=win_lum[:1])).mean(axis=0), fx)[None, :]
        if f.get("ribbon"):
            m = m[:, :1].repeat(m.shape[1], axis=1)
        # An office behind each lit window: a bright ceiling strip, the room, and a darker band
        # of furniture silhouettes at desk height (per-column heights from the facade's RNG),
        # all in window-band coordinates (0 at the band's foot, 1 at its head).
        bins = 32
        k = np.minimum((fy * bins).astype(int), bins - 1)
        rowband = m.max(axis=1) > 0
        on_bins = np.unique(k[rowband]) if rowband.any() else np.arange(bins)
        lo, hi = on_bins.min() / bins, (on_bins.max() + 1) / bins
        t = np.clip((fy - lo) / max(hi - lo, 1e-3), 0.0, 1.0)[:, None]
        cols = np.arange(x1 - x0)
        desk = 0.22 + 0.16 * np.interp(cols, np.arange(0, x1 - x0 + 8, 8), rng.random(len(np.arange(0, x1 - x0 + 8, 8))))[None, :]
        room = 0.62 + 0.55 * np.clip((t - 0.78) / 0.12, 0, 1) - 0.45 * (t < desk)
        out[y0:y1, x0:x1] = col * (m * room)[..., None]
        windows[y0:y1, x0:x1] = m
    # Roughness from the same windows (texels outside every facade rect keep theirs).
    rough = rgba[..., 3].copy()
    inside = np.zeros((H, W), dtype=bool)
    for f in spec["facades"]:
        x0, y0, x1, y1 = (round(f["rect"][0] * W), round(f["rect"][1] * H), round(f["rect"][2] * W), round(f["rect"][3] * H))
        inside[y0:y1, x0:x1] = True
    rough = np.where(inside, np.where(windows > 0.5, np.minimum(rough, 0.3), np.maximum(rough, 0.65)), rough)
    fixed = np.dstack([rgba[..., :3], rough])
    Image.fromarray((np.clip(fixed, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(
        TEX / name / "diffuse_rough_fixed.webp", quality=88, method=6, exact=True)
    return out


def clean_piers(name):
    """The bundle's own emissive, minus light on bright unsaturated piers of the photo."""
    rgb = _load(TEX / name / "diffuse_rough.webp", "RGB")
    em = _load(TEX / name / "emissive.webp", "RGB")
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    pier = np.clip((lum - 0.62) / 0.12, 0, 1) * np.clip((0.12 - sat) / 0.06, 0, 1)
    return em * (1.0 - pier)[..., None]


def main():
    # osaka was replaced by baked facades (art/facades/baked_osaka.json); rebuild() stays for
    # any future photo bundle whose maps do not depict its photo.
    for name, fix in (("glass_sky", clean_piers),):
        out = fix(name)
        img = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
        img.save(TEX / name / "emissive_fixed.webp", quality=90, method=6)
        print(name, "emissive_fixed.webp")
    return 0


if __name__ == "__main__":
    sys.exit(main())
