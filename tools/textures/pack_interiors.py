"""Pack the rendered room cards (build/interiors/*.png) into art/textures/interiors/:
interiors.webp (one atlas, a block of tiles per set) and interiors.json (room box, camera and
tile rects per set, read by src/materials/facade.ts). Every tile gets an edge-extended
border so mipmaps never bleed a neighbor in.

Usage: python3 tools/textures/pack_interiors.py <def.json> <cards dir> <out dir>
"""
import json
import sys
from pathlib import Path

from PIL import Image

PAD = 8


def pad(atlas, img, x, y):
    """Paste img at (x + PAD, y + PAD) with a PAD-wide border of its own edge pixels repeated
    (edge strips stretched outward, corner pixels filling the corners), so filtering and mips
    at a tile edge only ever see that tile's edge colour."""
    w, h = img.size
    atlas.paste(img, (x + PAD, y + PAD))
    strips = {
        (x + PAD, y): img.crop((0, 0, w, 1)).resize((w, PAD)),                  # top
        (x + PAD, y + PAD + h): img.crop((0, h - 1, w, h)).resize((w, PAD)),    # bottom
        (x, y + PAD): img.crop((0, 0, 1, h)).resize((PAD, h)),                  # left
        (x + PAD + w, y + PAD): img.crop((w - 1, 0, w, h)).resize((PAD, h)),    # right
    }
    for (cx, cy), (px, py) in (((x, y), (0, 0)), ((x + PAD + w, y), (w - 1, 0)),
                               ((x, y + PAD + h), (0, h - 1)), ((x + PAD + w, y + PAD + h), (w - 1, h - 1))):
        strips[(cx, cy)] = Image.new("RGB", (PAD, PAD), img.getpixel((px, py)))
    for pos, part in strips.items():
        atlas.paste(part, pos)


def main():
    spec = json.loads(Path(sys.argv[1]).read_text())
    cards, out = Path(sys.argv[2]), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    cols = spec.get("atlas_columns", 4)
    blocks, width, height = [], 0, 0
    for name, s in spec["sets"].items():
        tw, th = s["tile"]
        cw, ch = tw + 2 * PAD, th + 2 * PAD
        n = len(s["cards"])
        rows = (n + cols - 1) // cols
        blocks.append((name, s, height, cw, ch))
        width = max(width, cols * cw)
        height += rows * ch
    atlas = Image.new("RGB", (width, height))
    meta = {"size": [width, height], "pad": PAD, "sets": {}}
    for name, s, y0, cw, ch in blocks:
        tw, th = s["tile"]
        rects = []
        for i in range(len(s["cards"])):
            img = Image.open(cards / f"{name}_{i:02d}.png").convert("RGB")
            if img.size != (tw, th):
                raise SystemExit(f"{name}_{i:02d}.png is {img.size}, expected {(tw, th)}")
            x, y = (i % cols) * cw, y0 + (i // cols) * ch
            pad(atlas, img, x, y)
            # Tile rect in image pixels (y down): x0, y0, x1, y1 of the card itself.
            rects.append([x + PAD, y + PAD, x + PAD + tw, y + PAD + th])
        meta["sets"][name] = {k: s[k] for k in ("width", "height", "depth", "camera")}
        meta["sets"][name]["tiles"] = rects
    atlas.save(out / "interiors.webp", quality=90, method=6)
    (out / "interiors.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"interiors: {sum(len(s['tiles']) for s in meta['sets'].values())} cards, atlas {width}x{height}")


main()
