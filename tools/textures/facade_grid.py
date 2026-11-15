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
# A rhythm must fold this much sharper than noise to be trusted (contrast of the folded
# profile over the profile's own spread).
MIN_CONTRAST = 0.35
BINS = 96


def _signal(mask, axis):
    """Window coverage along `axis` (0: rows, 1: columns): 1 on glass, 0 on piers and spandrels."""
    return mask.mean(axis=1 - axis)


def _fold(p, period):
    idx = ((np.arange(len(p)) % period) / period * BINS).astype(int) % BINS
    return np.array([p[idx == b].mean() if np.any(idx == b) else 0.0 for b in range(BINS)])


def _contrast(p, period):
    f = _fold(p, period)
    return (f.max() - f.min()) / (p.std() + 1e-6)


def _period(p, guess, lo, hi):
    """Best period near `guess` (px), searched finely over [lo, hi]; harmonics of a true
    period fold almost as sharply, so prefer the smallest period within 90 % of the best."""
    cands = np.arange(lo, hi, 0.02)
    scores = np.array([_contrast(p, c) for c in cands])
    best = scores.max()
    ok = cands[scores >= 0.9 * best]
    # Near `guess` first: the importer's count comes from the bundle README or a coarse pass.
    near = ok[np.abs(ok - guess) <= 0.08 * guess]
    pick = near[np.argmax([_contrast(p, c) for c in near])] if len(near) else ok.min()
    return float(pick), float(_contrast(p, pick))


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
    """Centre of the wall band (a run of the profile below a third of its range) nearest `at`,
    within 0.35 of a period, or None: the grid's edges sit on real bands even where a slightly
    off period would drift over many floors. A run touching either end of the profile is a
    frame or blend at the source's edge, not a band, and is skipped."""
    lo = p.min() + (p.max() - p.min()) / 3
    a, b = max(0, int(at - 0.35 * period)), min(len(p), int(at + 0.35 * period) + 1)
    best = None
    i = a
    while i < b:
        if p[i] <= lo:
            j = i
            while j < len(p) and p[j] <= lo:
                j += 1
            k = i
            while k > 0 and p[k - 1] <= lo:
                k -= 1
            mid = (k + j - 1) / 2
            if k > 0 and j < len(p) and (best is None or abs(mid - at) < abs(best - at)):
                best = mid
            i = j
        else:
            i += 1
    return best


def _edges(p, period, phase):
    """First and last grid line inside the profile, each snapped to its band (stepping inward
    where an edge line finds no band), and the exact period between them (whole periods)."""
    lines = _lines(0, len(p), period, phase)
    snapped = [(_snap(p, y, period), y) for y in lines]
    found = [s for s, _ in snapped if s is not None]
    first, last = (found[0], found[-1]) if len(found) >= 2 else (lines[0], lines[-1])
    n = max(1, round((last - first) / period))
    return first, last, (last - first) / n, n


def _lines(start, end, period, phase):
    """Grid lines phase + k * period inside [start, end] (px, relative to start)."""
    first = phase % period
    return [first + k * period for k in range(int((end - start - first) // period) + 1)]


def measure(name):
    rgba = np.asarray(Image.open(TEX / name / "diffuse_rough.webp").convert("RGBA"), dtype=np.float32) / 255.0
    mask = np.asarray(Image.open(TEX / name / "window_mask.webp").convert("L"), dtype=np.float32) / 255.0
    H, W = rgba.shape[:2]
    spec = json.loads((TEX / f"{name}.json").read_text())
    out = []
    for f in spec["facades"]:
        hint = f.get("hint") or [f["floor"], f["bay"]]
        x0, y0, x1, y1 = (round(f["rect"][0] * W), round(f["rect"][1] * H), round(f["rect"][2] * W), round(f["rect"][3] * H))
        # A few texels in from the rect: the source edges carry a frame or a blend.
        m = 3
        crop = mask[y0 + m:y1 - m, x0 + m:x1 - m]
        rows, cols = _signal(crop, 0), _signal(crop, 1)
        g_floor = hint[0] * H
        floor, fc = _period(rows, g_floor, g_floor * 0.8, g_floor * 1.25)
        t, bt, floor, nfloors = _edges(rows, floor, _phase(rows, floor))
        gy0, gy1 = y0 + m + t, y0 + m + bt
        gx0, gx1 = x0 + m, x1 - m
        bay, bc = None, 0.0
        g_bay = hint[1] * W
        if g_bay < 0.5 * (x1 - x0):
            bay, bc = _period(cols, g_bay, max(8.0, g_bay * 0.8), g_bay * 1.25)
            if bc >= MIN_CONTRAST:
                lft, rgt, bay, _ = _edges(cols, bay, _phase(cols, bay))
                gx0, gx1 = x0 + m + lft, x0 + m + rgt
            else:
                bay = None
        if bay is None:
            bay = gx1 - gx0
        out.append({
            "rect": f["rect"],
            "hint": hint,
            "floor": floor / H,
            "bay": bay / W,
            "grid": [gx0 / W, gy0 / H, gx1 / W, gy1 / H],
            "wrap": [(gx1 - gx0) / W, (gy1 - gy0) / H],
            "floors": nfloors,
            "bays": round((gx1 - gx0) / bay),
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
    Top strip: the grid's top 1.5 floors (the top of a wrap); a thin red line; then the grid's
    bottom 1.5 floors, sitting on a thick red bar (a tier's base, and the floors a wrap continues
    with). A row must not be cut at the bar or the thin line."""
    tiles = []
    for name, facades in facades_by_bundle:
        img = Image.open(TEX / name / "diffuse_rough.webp").convert("RGB")
        W, H = img.size
        for i, f in enumerate(facades):
            gx0, gy0, gx1, gy1 = f["grid"][0] * W, f["grid"][1] * H, f["grid"][2] * W, f["grid"][3] * H
            fl, w = f["floor"] * H, min(gx1 - gx0, 200)
            top = img.crop((int(gx0), int(round(gy0)), int(gx0 + w), int(round(gy0 + 1.5 * fl))))
            bot = img.crop((int(gx0), int(round(gy1 - 1.5 * fl)), int(gx0 + w), int(round(gy1))))
            t = Image.new("RGB", (int(w), top.height + bot.height + 12), (255, 0, 0))
            t.paste(top, (0, 0))
            t.paste(bot, (0, top.height + 2))
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
