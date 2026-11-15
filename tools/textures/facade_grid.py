"""Measure the window grid of every tower facade in the committed atlas bundles and record it
in art/external/textures/<bundle>.json, so the runtime only ever shows whole floors and bays.

  python3 tools/textures/facade_grid.py            # measure, update the JSONs, draw overlays
  python3 tools/textures/facade_grid.py --check    # verify the JSONs match a fresh measurement

Per facade it finds, from the window mask (<bundle>/window_mask.webp: glass 1, wall 0; written by
tools/textures/import_highrise.py from the source pack):
  hint            [floor, bay]: the importer's estimate, kept unchanged so every run searches
                  from the same place (the measurement is idempotent)
  floor, bay      the period in atlas UV units (refined around the hint)
  grid            [x0, y0, x1, y1] in image space (y down): a sub-rectangle of the facade whose
                  edges are floor lines (the middle of the widest window-free band in a floor:
                  the spandrel, or the slab line of a curtain wall) and bay lines (the middle of
                  the widest window-free band in a bay: the pier or mullion),
                  holding whole floors and whole bays. The shader wraps inside it, so a wrap or
                  a tier's base never cuts a window.
  wrap            [x1 - x0, y1 - y0]
A facade with no clear column rhythm (ribbon glazing) keeps bay = its grid width.
Overlays (lines drawn on each facade) go to build/previews/facade-grid/ for a visual check.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
TEX = ROOT / "art" / "external" / "textures"
BUNDLES = ("osaka", "real_glass", "glass_sky")
PREVIEW = ROOT / "build" / "previews" / "facade-grid"
PERIODS = TEX / "facade_periods.json"
# A column rhythm must reach this autocorrelation peak to be trusted; below it the facade is
# treated as ribbon glazing (one bay as wide as the grid).
MIN_CONTRAST = 0.3
BINS = 96


def _signal(mask, rgba, axis):
    """Window-ness along `axis` (0: rows, 1: columns): high on glass, low on piers and spandrels.
    The window mask's coverage; where the mask has no rhythm along this axis (it marks some
    curtain walls' slab bands as glass) the photo's: smooth and dark is glass."""
    p = mask.mean(axis=1 - axis)
    if float(p.max() - p.min()) > 0.2:
        return p
    out = []
    for ch in (rgba[..., 3], rgba[..., :3].mean(axis=2)):
        q = ch.mean(axis=1 - axis)
        out.append(1.0 - (q - q.min()) / max(float(q.max() - q.min()), 1e-6))
    return np.mean(out, axis=0)


def _fold(p, period):
    idx = ((np.arange(len(p)) % period) / period * BINS).astype(int) % BINS
    return np.array([p[idx == b].mean() if np.any(idx == b) else 0.0 for b in range(BINS)])


def _contrast(p, period):
    f = _fold(p, period)
    return (f.max() - f.min()) / (p.std() + 1e-6)


def _period(p, guess, lo, hi):
    """Period (px) of the profile's rhythm: the strongest autocorrelation peak in [lo, hi],
    refined to a fraction of a pixel by a parabola through the peak and its neighbours. (The
    fold-contrast search used before read periods 3-5 px short, enough to drift the lines a
    whole window across a facade.) Returns (period, peak height)."""
    q = p - p.mean()
    ac = np.correlate(q, q, mode="full")[len(q) - 1:]
    if ac[0] <= 0:
        return guess, 0.0
    ac = ac / ac[0]
    a, b = max(2, int(np.floor(lo))), min(len(ac) - 2, int(np.ceil(hi)))
    peaks = [i for i in range(a, b + 1) if ac[i] >= ac[i - 1] and ac[i] >= ac[i + 1]]
    if not peaks:
        return guess, 0.0
    i = max(peaks, key=lambda i: ac[i])
    den = ac[i - 1] - 2 * ac[i] + ac[i + 1]
    off = 0.5 * (ac[i - 1] - ac[i + 1]) / den if den < 0 else 0.0
    return float(i + off), float(ac[i])


def _phase(p, period):
    """Offset (px) of the line in the middle of the wall band (spandrel / pier): the centre of
    the longest stretch of the folded profile below a third of the way from its least to its
    most glazed level (circular: a band may wrap past the fold's end)."""
    f = _fold(p, period)
    low = f <= f.min() + (f.max() - f.min()) / 3
    best, best_mid = 0, float(np.argmin(f))
    for start in range(BINS):
        if not low[start] or low[start - 1]:
            continue                       # only the first bin of a run
        n = 0
        while n < BINS and low[(start + n) % BINS]:
            n += 1
        if n > best:
            best, best_mid = n, start + (n - 1) / 2
    if low.all():
        best_mid = float(np.argmin(f))
    return ((best_mid + 0.5) % BINS) / BINS * period


def _snap(p, at, period):
    """Centre of the wall band nearest `at`, within 0.35 of a period, or None. The profile is
    smoothed over ~15 % of a period (a wide spandrel outweighs a thin transom inside a window);
    the band is its deepest point there, if that sits at least 15 % of the local range below the
    local top, centred on the stretch within 10 % of the dip. Dips at the profile's ends are the
    source's frame, not bands."""
    k = max(3, int(round(0.15 * period)) | 1)
    q = np.convolve(np.pad(p, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    a, b = max(1, int(round(at - 0.35 * period))), min(len(q) - 1, int(round(at + 0.35 * period)) + 1)
    if b - a < 3:
        return None
    w = q[a:b]
    lo, hi = float(w.min()), float(w.max())
    if hi - lo < 0.15 * max(abs(hi), 1e-6) or hi - lo < 0.02:
        return None
    m = a + int(np.argmin(w))
    cut = lo + 0.1 * (hi - lo)
    i = j = m
    while i > a and q[i - 1] <= cut:
        i -= 1
    while j < b - 1 and q[j + 1] <= cut:
        j += 1
    if i <= 1 or j >= len(q) - 2:
        return None
    return (i + j) / 2


def _fit(p, period, phase):
    """Evenly spaced lines anchored on a measured band: the last expected line near the end of
    the profile that finds its band (_snap) is the anchor; the others are whole periods from it,
    so a grid between two of them holds exactly whole periods. Returns (lines inside the
    profile, period, share of the lines that land within 0.15 of a period of a band)."""
    guesses = _lines(0, len(p), period, phase)
    anchor = next((s for s in (_snap(p, y, period) for y in reversed(guesses[-3:])) if s is not None), guesses[-1])
    k0 = int(np.floor((anchor - 2) / period))
    lines = [anchor - k * period for k in range(k0, -1, -1)]
    hits = [(_snap(p, y, period)) for y in lines]
    on = sum(1 for y, h in zip(lines, hits) if h is not None and abs(h - y) <= 0.15 * period)
    return lines, period, on / max(len(lines), 1)


def _lines(start, end, period, phase):
    """Grid lines phase + k * period inside [start, end] (px, relative to start)."""
    first = phase % period
    return [first + k * period for k in range(int((end - start - first) // period) + 1)]


def measure(name):
    rgba = np.asarray(Image.open(TEX / name / "diffuse_rough.webp").convert("RGBA"), dtype=np.float32) / 255.0
    mask = np.asarray(Image.open(TEX / name / "window_mask.webp").convert("L"), dtype=np.float32) / 255.0
    H, W = rgba.shape[:2]
    spec = json.loads((TEX / f"{name}.json").read_text())
    curated = json.loads(PERIODS.read_text())
    periods, bays = curated[name], curated.get(f"bays_{name}", [None] * len(curated[name]))
    out = []
    for f, fp, bp in zip(spec["facades"], periods, bays):
        hint = f.get("hint") or [f["floor"], f["bay"]]
        x0, y0, x1, y1 = (round(f["rect"][0] * W), round(f["rect"][1] * H), round(f["rect"][2] * W), round(f["rect"][3] * H))
        # A few texels in from the rect: the source edges carry a frame or a blend.
        m = 3
        crop, photo = mask[y0 + m:y1 - m, x0 + m:x1 - m], rgba[y0 + m:y1 - m, x0 + m:x1 - m]
        rows, cols = _signal(crop, photo, 0), _signal(crop, photo, 1)
        floor, fc = _period(rows, fp, fp * 0.97, fp * 1.03)
        ys, floor, yhit = _fit(rows, floor, _phase(rows, floor))
        ys = [y0 + m + y for y in ys]
        xs, xhit, bc, ribbon = [x0 + m, x1 - m], 1.0, 0.0, True
        g_bay = bp if bp else hint[1] * W
        if g_bay < 0.5 * (x1 - x0):
            spread = 0.1 if bp else 0.15
            bay, bc = _period(cols, g_bay, max(8.0, g_bay * (1 - spread)), g_bay * (1 + spread))
            if bp or bc >= MIN_CONTRAST:
                lines, bay, xhit = _fit(cols, bay, _phase(cols, bay))
                if len(lines) >= 2:
                    xs, ribbon = [x0 + m + x for x in lines], False
        out.append({
            "rect": f["rect"],
            "hint": hint,
            "floor": (ys[-1] - ys[0]) / (len(ys) - 1) / H,
            "bay": (xs[-1] - xs[0]) / (len(xs) - 1) / W,
            "grid": [xs[0] / W, ys[0] / H, xs[-1] / W, ys[-1] / H],
            "wrap": [(xs[-1] - xs[0]) / W, (ys[-1] - ys[0]) / H],
            "floors": len(ys) - 1,
            "bays": len(xs) - 1,
            # No column rhythm (ribbon glazing): the runtime fits no bays across.
            "ribbon": ribbon,
            "contrast": [round(fc, 2), round(bc, 2)],
        })
    return spec, out, rgba


def overlay(name, rgba, facades):
    PREVIEW.mkdir(parents=True, exist_ok=True)
    H, W = rgba.shape[:2]
    img = Image.fromarray((rgba[..., :3] * 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for f in facades:
        gx0, gy0, gx1, gy1 = f["grid"][0] * W, f["grid"][1] * H, f["grid"][2] * W, f["grid"][3] * H
        y = gy0
        while y <= gy1 + 0.5:
            d.line([(gx0, y), (gx1, y)], fill=(255, 40, 40), width=1)
            y += f["floor"] * H
        x = gx0
        while x <= gx1 + 0.5:
            d.line([(x, gy0), (x, gy1)], fill=(40, 220, 255), width=1)
            x += f["bay"] * W
        d.rectangle([gx0, gy0, gx1, gy1], outline=(255, 230, 0), width=2)
    img.save(PREVIEW / f"{name}.png")


def seams(facades_by_bundle):
    """build/previews/facade-grid/seams.png: per facade, what the runtime shows at a band's edges.
    Upper panel, the wrap seam: going up past the grid's top line the shader continues from its
    bottom line, so the bottom 1.5 floors sit on a thin red line over the top 1.5 floors. Lower
    panel, a tier's base: the bottom 1.5 floors on a thick red bar. No window may be cut at
    either line."""
    tiles = []
    for name, facades in facades_by_bundle:
        img = Image.open(TEX / name / "diffuse_rough.webp").convert("RGB")
        W, H = img.size
        for i, f in enumerate(facades):
            gx0, gy0, gx1, gy1 = f["grid"][0] * W, f["grid"][1] * H, f["grid"][2] * W, f["grid"][3] * H
            fl, w = f["floor"] * H, min(gx1 - gx0, 200)
            top = img.crop((int(gx0), int(round(gy0)), int(gx0 + w), int(round(gy0 + 1.5 * fl))))
            bot = img.crop((int(gx0), int(round(gy1 - 1.5 * fl)), int(gx0 + w), int(round(gy1))))
            t = Image.new("RGB", (int(w), 2 * bot.height + top.height + 18), (40, 40, 40))
            t.paste(bot, (0, 0))
            ImageDraw.Draw(t).line([(0, bot.height), (w, bot.height)], fill=(255, 0, 0), width=1)
            t.paste(top, (0, bot.height + 1))
            y = bot.height + top.height + 8
            t.paste(bot, (0, y))
            ImageDraw.Draw(t).rectangle([0, y + bot.height, w, y + bot.height + 6], fill=(255, 0, 0))
            ImageDraw.Draw(t).text((2, 2), f"{name[:2]}{i}", fill=(255, 255, 0))
            tiles.append(t.resize((t.width * 2, t.height * 2)))
    cw, ch = max(t.width for t in tiles), max(t.height for t in tiles)
    sheet = Image.new("RGB", (cw * 7, ch * ((len(tiles) + 6) // 7)), (40, 40, 40))
    for k, t in enumerate(tiles):
        sheet.paste(t, ((k % 7) * cw, (k // 7) * ch))
    sheet.save(PREVIEW / "seams.png")


def check_spec(name, facades):
    """Invariants the shader relies on. Returns a list of problems."""
    bad = []
    for i, f in enumerate(facades):
        if "grid" not in f:
            bad.append(f"{name}[{i}]: no grid (run tools/textures/facade_grid.py)")
            continue
        gx0, gy0, gx1, gy1 = f["grid"]
        r = f["rect"]
        if not (r[0] <= gx0 < gx1 <= r[2] and r[1] <= gy0 < gy1 <= r[3]):
            bad.append(f"{name}[{i}]: grid outside its rect")
        for size, period, what in ((gy1 - gy0, f["floor"], "floors"), (gx1 - gx0, f["bay"], "bays")):
            n = size / period
            if abs(n - round(n)) > 1e-3 or round(n) < 1:
                bad.append(f"{name}[{i}]: grid holds {n:.3f} {what}, not a whole number")
        if abs(f["wrap"][0] - (gx1 - gx0)) > 1e-6 or abs(f["wrap"][1] - (gy1 - gy0)) > 1e-6:
            bad.append(f"{name}[{i}]: wrap differs from the grid size")
    return bad


def main(check=False):
    problems = []
    measured = []
    for name in BUNDLES:
        spec, facades, rgba = measure(name)
        if check:
            stored = spec["facades"]
            problems += check_spec(name, stored)
            for i, (a, b) in enumerate(zip(stored, facades)):
                if "grid" in a and any(abs(p - q) > 1.5 / 2048 for p, q in zip(a["grid"], b["grid"])):
                    problems.append(f"{name}[{i}]: stored grid differs from a fresh measurement")
            continue
        problems += check_spec(name, facades)
        spec["facades"] = facades
        (TEX / f"{name}.json").write_text(json.dumps(spec, indent=2) + "\n")
        overlay(name, rgba, facades)
        measured.append((name, facades))
        for i, f in enumerate(facades):
            print(f"{name}[{i}] floors {f['floors']:>3} of {f['floor'] * 2048:6.2f}px  bays {f['bays']:>3} of {f['bay'] * 2048:6.2f}px  contrast {f['contrast']}")
    if measured:
        seams(measured)
    for p in problems:
        print("PROBLEM", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(check="--check" in sys.argv))
