"""Wall material atlas for the facade shader (wallSample in src/materials/facade/common.ts).

    python3 tools/textures/pack_walls.py            then: npm run textures

Sources: art/external/textures/walls/<cell>.webp, made with Z-Image Turbo (prompts, seeds and the
crop of each in walls.def.json beside them), already seamless:
  - "quilt" cells came out of `img --tile` (image quilting);
  - "grid" cells are untiled takes cut by tools/textures/pack_walls.py --prepare: on an axis with
    joints the crop runs between joint centres, a whole number of periods, so the wrap lands
    inside a joint (joints found by autocorrelation, or `find: peaks` for dark lines on a busy
    texture); on a uniform axis (along long panel joints) the ends are crossfaded (`fade`), or for ribs
    (`uniform`) the column profile is repeated with the take's surface detail crossfaded over it.

Writes art/textures/walls/walls.webp: 4 x 2 slots of 1024 px, each the material at 960 px with a
32 px wrap-around gutter (so filtering and mips across the repeat read the material itself),
RGB = albedo with its large-scale light flattened, matched to the slot's reference mean colour (`mean`, sRGB, the old photo cell's
calibration), A = roughness (`rough`). Cell order and names stay those of walls.json.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'art' / 'external' / 'textures' / 'walls'
OUT = ROOT / 'art' / 'textures' / 'walls'
SLOT, PAD = 1024, 32
INNER = SLOT - 2 * PAD


def to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(l):
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.maximum(l, 0), 1 / 2.4) - 0.055)


def blur(a, sigma):
    """Periodic Gaussian blur (the tiles are seamless, so wrap-around is exact)."""
    f = np.fft.fftfreq(a.shape[0])[:, None] ** 2 + np.fft.fftfreq(a.shape[1])[None, :] ** 2
    k = np.exp(-2 * (np.pi * sigma) ** 2 * f)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k))


def joints_peaks(profile, period_range):
    """Joint centres along a brightness profile: dark lines standing out of a rolling median
    (window ~ the largest period), kept when their spacing stays within `period_range`; the
    longest evenly spaced run wins. Each centre is darkness-weighted (sub-pixel)."""
    lo, hi = period_range
    n = len(profile)
    win = max(5, hi // 2) | 1
    pad = np.pad(profile, win // 2, mode='edge')
    base = np.array([np.median(pad[i:i + win]) for i in range(n)])
    dark = np.clip(base - profile, 0, None)
    # Peaks: local maxima of darkness above a threshold, at least lo/2 apart.
    thr = dark.mean() + 2 * dark.std()
    cand = [i for i in range(1, n - 1) if dark[i] >= thr and dark[i] == dark[max(0, i - lo // 2):i + lo // 2 + 1].max()]
    def centre(c):
        a, b = max(0, c - 6), min(n, c + 7)
        w = dark[a:b] ** 2
        return a + (w * np.arange(b - a)).sum() / w.sum()
    cs = [centre(c) for c in cand]
    # Longest evenly spaced chain: the first gap (in [lo, hi]) sets the period; later gaps must be
    # one or two periods (a faint joint missed) within 12 %. Periods are counted, not joints.
    best, best_n = [], 0
    for i in range(len(cs)):
        for j in range(i + 1, len(cs)):
            p0 = cs[j] - cs[i]
            if not lo <= p0 <= hi:
                continue
            chain, n = [cs[i], cs[j]], 1
            for c in cs[j + 1:]:
                k = round((c - chain[-1]) / p0)
                if k in (1, 2) and abs(c - chain[-1] - k * p0) <= 0.12 * p0:
                    chain.append(c)
                    n += k
                elif c - chain[-1] > 2.2 * p0:
                    break
            if n > best_n:
                best, best_n = chain, n
    period = (best[-1] - best[0]) / max(1, best_n)
    return round(period, 1), best


def joints_autocorr(profile, period_range):
    """Joint centres along a brightness profile: the period by autocorrelation, then each joint as
    the darkness-weighted centre of a window around the profile's minima at that period."""
    p = profile - profile.mean()
    ac = np.correlate(p, p, 'full')[len(p) - 1:]
    lo, hi = period_range
    period = lo + int(np.argmax(ac[lo:hi]))
    dark = np.clip(np.percentile(profile, 60) - profile, 0, None)
    # Phase: the offset whose comb sums the most darkness.
    phase = int(np.argmax([dark[o::period].sum() for o in range(period)]))
    centres = []
    for c in range(phase, len(profile), period):
        a, b = max(0, c - period // 6), min(len(profile), c + period // 6 + 1)
        w = dark[a:b] ** 2
        if w.sum() > 0:
            centres.append(a + (w * np.arange(b - a)).sum() / w.sum())
    return period, centres


def crossfade(a, axis, frac=0.12):
    """Seamless along `axis`: the last `frac` crossfaded over the first, then dropped."""
    a = np.moveaxis(a, axis, 0)
    n = int(len(a) * frac)
    t = np.linspace(0, 1, n, dtype=np.float32)[:, None, None]
    head = a[:n] * t + a[-n:] * (1 - t)
    return np.moveaxis(np.concatenate([head, a[n:-n]]), 0, axis)


def prepare(cell):
    """Cut an untiled take into a seamless tile (grid cells); writes <name>.webp and records the crop."""
    im = np.asarray(Image.open(ROOT / cell['take']).convert('RGB'), np.float32)
    # Optional pre-trim (left, top, right, bottom px): a frame or vignette at the take's edges.
    l, t, r, b = cell.get('trim', [0, 0, 0, 0])
    im = im[t:im.shape[0] - b, l:im.shape[1] - r]
    lum = im.mean(2)
    box = [0, 0, im.shape[1], im.shape[0]]
    for axis, mode in (('x', cell['x']), ('y', cell['y'])):
        if mode != 'joints':
            continue
        prof = lum.mean(0) if axis == 'x' else lum.mean(1)
        pr = cell.get('period', [24, len(prof) // 2])
        find = joints_peaks if cell.get('find') == 'peaks' else joints_autocorr
        period, cs = find(prof, pr[axis] if isinstance(pr, dict) else pr)
        n = len(cs) - 1
        if n < 1:
            raise SystemExit(f"{cell['name']}: fewer than two joints on {axis}")
        i0, i1 = (0, 2) if axis == 'x' else (1, 3)
        box[i0], box[i1] = cs[0], cs[-1]
        print(f"  {cell['name']} {axis}: period {period} px, {n} periods between {cs[0]:.1f} and {cs[-1]:.1f}")
    tile = Image.fromarray(im.astype(np.uint8)).transform((round(box[2] - box[0]), round(box[3] - box[1])), Image.EXTENT, tuple(box), Image.BICUBIC)
    a = np.asarray(tile, np.float32)
    if cell['x'] == 'fade':
        a = crossfade(a, 1)
    if cell['y'] == 'fade':
        a = crossfade(a, 0)
    elif cell['y'] == 'uniform':
        # Ribs: the column profile (perfectly straight ribs) plus the take's own surface detail
        # around it, crossfaded and at reduced strength, so a slight tilt cannot leave a band.
        profile = a.mean(0, keepdims=True)
        a = profile + crossfade(a - profile, 0) * cell.get('detail', 0.6)
    cell['crop'] = [round(v, 1) for v in box]
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def main():
    path = SRC / 'walls.def.json'
    d = json.loads(path.read_text())
    if '--prepare' in sys.argv:
        only = set(sys.argv[sys.argv.index('--prepare') + 1:])
        for cell in d['cells']:
            if cell['method'] == 'grid' and (not only or cell['name'] in only):
                prepare(cell).resize((1024, 1024), Image.LANCZOS).save(SRC / f"{cell['name']}.webp", quality=95)
            elif cell['method'] == 'quilt' and (not only or cell['name'] in only):
                Image.open(ROOT / cell['take']).convert('RGB').save(SRC / f"{cell['name']}.webp", quality=95)
        path.write_text(json.dumps(d, indent=2) + '\n')
        return
    OUT.mkdir(parents=True, exist_ok=True)
    atlas = np.zeros((2 * SLOT, 4 * SLOT, 4), np.float32)
    for i, cell in enumerate(d['cells']):
        rgb = to_linear(np.asarray(Image.open(SRC / f"{cell['name']}.webp").convert('RGB').resize((INNER, INNER), Image.LANCZOS), np.float32) / 255)
        target = to_linear(np.array(cell['mean'], np.float32) / 255)
        # Flatten large-scale light and blotches (`flatten` 0..1 of the low frequencies, σ = 1/8
        # tile): a gradient or a dark band in the take would repeat as stripes across a wall.
        lum = rgb.mean(2)
        low = blur(lum, INNER / 8)
        rgb *= ((low.mean() / np.maximum(low, 1e-4)) ** cell.get('flatten', 0.7))[..., None]
        # `contrast` scales the detail around the mean (linear light): bland takes get it back.
        m = rgb.reshape(-1, 3).mean(0)
        rgb = m + (rgb - m) * cell.get('contrast', 1.0)
        rgb *= target / rgb.reshape(-1, 3).mean(0)
        a = np.dstack([to_srgb(np.clip(rgb, 0, 1)), np.full(rgb.shape[:2], cell['rough'] / 255, np.float32)])
        a = np.pad(a, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='wrap')
        r, c = divmod(i, 4)
        atlas[r * SLOT:(r + 1) * SLOT, c * SLOT:(c + 1) * SLOT] = a
        print(f"walls[{i}] {cell['name']}: {cell['method']}, mean {cell['mean']}, rough {cell['rough']}")
    Image.fromarray((atlas * 255 + 0.5).astype(np.uint8), 'RGBA').save(OUT / 'walls.webp', lossless=True, method=6)
    (OUT / 'walls.json').write_text(json.dumps({'grid': [4, 2], 'slot': SLOT, 'pad': PAD, 'cells': [c['name'] for c in d['cells']]}, indent=2) + '\n')


if __name__ == '__main__':
    main()
