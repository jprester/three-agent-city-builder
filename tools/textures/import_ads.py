"""Pack the human-provided neon signs and ads (art/external/textures/{small-ads,ads-v2}) into
runtime atlases. Sources stay local (gitignored); outputs are committed. Reproducible:
  python3 tools/textures/import_ads.py

Any aspect works: each image goes to the atlas whose slot shape fits it best (neon_v tall,
posters_p portrait, posters_l landscape, neon_h wide) and is fitted inside the slot without
cropping. catalog.json records per image: kind (neon | ad), atlas, the UV rect of the image
itself, its exact aspect (the layout sizes signs to it), `holo` (dark background: renders as
an additive hologram), and its dominant light color/hue (light spill, warm weighting).
screens.webp holds the portrait ads in uniform 2:3 slots for the tower screens.
"""
import colorsys
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art" / "external" / "textures"
OUT = SRC / "signs"

# Files carrying another Midjourney user's name: not ours to use (see docs/DECISIONS.md).
EXCLUDE = ("coinone_", "disagiovanile_", "g0crazyg0stupid_", "joan12404_")


def sources(pattern):
    return [p for p in sorted(SRC.glob(pattern)) if not p.name.startswith(EXCLUDE)]


def light_color(im):
    a = np.asarray(im.convert("RGB").resize((96, 96)), dtype=np.float32) / 255.0
    lum = a.max(axis=2)
    sel = a[lum >= np.quantile(lum, 0.92)]
    c = sel.mean(axis=0)
    h, s, v = colorsys.rgb_to_hsv(*(float(x) for x in c))
    return [round(float(x), 3) for x in c], round(h * 360), round(s, 2)


BUCKETS = [  # (name, slot w, slot h, columns, max aspect): each image goes to the first that fits
    ("neon_v", 192, 768, 16, 0.5),
    ("posters_p", 384, 576, 9, 1.2),
    ("posters_l", 576, 384, 7, 2.5),
    ("neon_h", 768, 192, 5, 99),
]


def dark_background(im):
    """True if the image is mostly near-black: then it renders as an additive hologram
    (black = transparent). Photo posters with bright backgrounds stay opaque boards."""
    a = np.asarray(im.convert("RGB").resize((64, 64)), dtype=np.float32).max(axis=2) / 255.0
    return bool((a < 0.12).mean() > 0.45)


def pack(items, slot_w, slot_h, cols, name, gap=4):
    rows = max(1, (len(items) + cols - 1) // cols)
    W, H = cols * slot_w, rows * slot_h
    atlas = Image.new("RGB", (W, H))
    entries = []
    for i, (path, kind, im) in enumerate(items):
        x, y = (i % cols) * slot_w, (i // cols) * slot_h
        fit = im.copy()
        fit.thumbnail((slot_w - 2 * gap, slot_h - 2 * gap), Image.LANCZOS)
        ox, oy = x + (slot_w - fit.width) // 2, y + (slot_h - fit.height) // 2
        atlas.paste(fit, (ox, oy))
        color, hue, sat = light_color(im)
        entries.append({
            "id": path.stem[:48], "kind": kind, "atlas": name,
            # Rect of the image itself (not its slot) in UV space, v up: aspect-exact.
            "rect": [round(ox / W, 6), round(1 - (oy + fit.height) / H, 6), round(fit.width / W, 6), round(fit.height / H, 6)],
            "aspect": round(im.width / im.height, 4), "holo": kind == "neon" or dark_background(im),
            "color": color, "hue": hue, "sat": sat,
        })
    atlas.save(OUT / f"{name}.webp", quality=86, method=6)
    return entries


def collect():
    """(path, kind) for every source image. kind "neon": signs (blades, panels, strips);
    kind "ad": posters and ads (billboards, screens). Drop new art, any aspect, into
    signs-src/neon/ or signs-src/ads/; the older folders are read too."""
    out = []
    for pattern, kind in [("signs-src/neon/*", "neon"), ("small-ads/small-ads-1-4/*.png", "neon"),
                          ("small-ads/small-ads-4-1/*.png", "neon"), ("ads-v2/nova.png", "neon"),
                          ("signs-src/ads/*", "ad"), ("ads-v2/*.png", "ad"),
                          ("small-ads/small-ads-2-3/*.png", "ad"), ("small-ads/small-ads-3-2/*.png", "ad")]:
        for p in sources(pattern):
            if p.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp") or (kind == "ad" and p.name == "nova.png"):
                continue
            out.append((p, kind))
    return out


def main():
    OUT.mkdir(exist_ok=True)
    buckets = {b[0]: [] for b in BUCKETS}
    for path, kind in collect():
        im = Image.open(path).convert("RGB")
        a = im.width / im.height
        name = next(b[0] for b in BUCKETS if a <= b[4])
        buckets[name].append((path, kind, im))
    entries, sizes = [], {}
    for name, w, h, cols, _ in BUCKETS:
        es = pack(buckets[name], w, h, cols, name)
        entries += es
        img = Image.open(OUT / f"{name}.webp")
        sizes[name] = [img.width, img.height]
    # Screens: portrait ads letterboxed into uniform 2:3 slots, addressed by index.
    screens = [(p, k, im) for p, k, im in buckets["posters_p"] if k == "ad"]
    pack(screens, 384, 576, 9, "screens")
    (OUT / "catalog.json").write_text(json.dumps({"entries": entries, "sizes": sizes,
        "screens": {"count": len(screens), "cols": 9, "rows": max(1, (len(screens) + 8) // 9)}}, indent=1) + "\n")
    for f in ("neon.json", "posters.json"):
        (OUT / f).unlink(missing_ok=True)
    kinds = {}
    for e in entries:
        kinds[(e["kind"], e["holo"])] = kinds.get((e["kind"], e["holo"]), 0) + 1
    print(len(entries), "entries; (kind, holo):", kinds, "screens", len(screens))


if __name__ == "__main__":
    main()
