"""Pack the human-provided neon signs and ads (art/external/textures/{small-ads,ads-v2}) into
runtime atlases. Sources stay local (gitignored); outputs are committed. Reproducible:
  python3 tools/textures/import_ads.py

Outputs in art/external/textures/signs/:
  neon.webp / neon.json          vertical (1:4) and horizontal (4:1) neon signs
  posters_p.webp / posters.json  portrait (2:3) posters and ads
  posters_l.webp                 landscape (3:2) posters and ads
Each image is fitted onto black inside its slot (backgrounds are near-black, so padding is
invisible). JSON records every slot's UV rect (three.js space, v up), the image's own aspect,
and its dominant light color (mean of the brightest pixels) for sign light spill and for
weighting warm signs over cyan/magenta ones (style bible).
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


def pack(items, slot_w, slot_h, cols, name, gap=4):
    rows = (len(items) + cols - 1) // cols
    W, H = cols * slot_w, rows * slot_h
    atlas = Image.new("RGB", (W, H))
    entries = []
    for i, (path, tag) in enumerate(items):
        im = Image.open(path).convert("RGB")
        x, y = (i % cols) * slot_w, (i // cols) * slot_h
        fit = im.copy()
        fit.thumbnail((slot_w - 2 * gap, slot_h - 2 * gap), Image.LANCZOS)
        ox, oy = x + (slot_w - fit.width) // 2, y + (slot_h - fit.height) // 2
        atlas.paste(fit, (ox, oy))
        color, hue, sat = light_color(im)
        entries.append({
            "id": path.stem[:48], "tag": tag,
            # Rect of the image itself (not the slot) in UV space, v up.
            "rect": [ox / W, 1 - (oy + fit.height) / H, fit.width / W, fit.height / H],
            "aspect": round(im.width / im.height, 3), "color": color, "hue": hue, "sat": sat,
        })
    atlas.save(OUT / f"{name}.webp", quality=86, method=6)
    return entries, [W, H]


def main():
    OUT.mkdir(exist_ok=True)
    vertical = [(p, "vertical") for p in sources("small-ads/small-ads-1-4/*.png")] + [(SRC / "ads-v2/nova.png", "vertical")]
    horizontal = [(p, "horizontal") for p in sources("small-ads/small-ads-4-1/*.png")]
    v, vsize = pack(vertical, 192, 768, 15, "neon_v")
    h, hsize = pack(horizontal, 768, 192, 5, "neon_h")
    portrait_ads = ["kuro-arcade", "luna-tea", "neon-runner", "legacy-pixel-koi", "kitsune", "orbit-ramen", "aero-9", "mori-synth"]
    portrait = [(SRC / f"ads-v2/{n}.png", "ad") for n in portrait_ads] + [(p, "poster") for p in sources("small-ads/small-ads-2-3/*.png")]
    landscape_ads = ["dreamstate-fm", "nightline", "sora-motors", "volt-cola"]
    landscape = [(SRC / f"ads-v2/{n}.png", "ad") for n in landscape_ads] + [(p, "poster") for p in sources("small-ads/small-ads-3-2/*.png")]
    p, psize = pack(portrait, 384, 576, 9, "posters_p")
    l, lsize = pack(landscape, 576, 384, 7, "posters_l")
    (OUT / "neon.json").write_text(json.dumps({"vertical": v, "verticalSize": vsize, "horizontal": h, "horizontalSize": hsize}, indent=1) + "\n")
    (OUT / "posters.json").write_text(json.dumps({"portrait": p, "portraitSize": psize, "landscape": l, "landscapeSize": lsize}, indent=1) + "\n")
    print(f"vertical {len(v)} {vsize}, horizontal {len(h)} {hsize}, portrait {len(p)} {psize}, landscape {len(l)} {lsize}")
    print("hues:", sorted(e["hue"] for e in v + h))


if __name__ == "__main__":
    main()
