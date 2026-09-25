"""Import the human-provided "High-Rise Atlas v1" facade bundles into art/external/textures/.

Reproducible: run with the source folder to regenerate every output.
  python3 tools/textures/import_highrise.py /path/to/generated-texture-atlas

Per bundle it writes (2048², WebP):
  <name>/diffuse_rough.webp   RGB diffuse (sRGB) + A roughness (linear)
  <name>/emissive.webp        emissive A (sRGB), clipped to windows by the source
  <name>/normal.webp          OpenGL normal (linear)
  <name>.json                 facade rects (0..1, image y down) and, detected from the
                              window mask, each facade's floor and bay period in texels,
                              so the shader can map meters to texels and wrap on whole
                              floors/bays (source edges are not seamless)
and one wall-material atlas from the bundles' opaque tiles:
  walls.webp / walls.json     4×2 cells of 512², RGB diffuse + A roughness
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parents[2] / "art" / "external" / "textures"
SIZE = 2048

# Documented floors per facade cell (bundle READMEs); detected counts are folded into range.
FLOOR_RANGE = {"real_glass": (12, 20), "glass_sky": (22, 30)}

BUNDLES = {
    # emissive-A of this bundle is a truncated PNG in the source folder; B_fixed is intact.
    "osaka": ("High-Rise_Atlas4/highrise-atlas-v1_osaka-modern-02_bundle", "highrise-v1-osaka-modern-02", "emissive-B_4K_fixed", "diffuse_4K"),
    "real_glass": ("highrise-v1-real-glass-02_bundle", "highrise-v1-real-glass-02", "emissive-A_4K", "diffuse_4K"),
    "glass_sky": ("Skyscraper-Glass-Atlas1/highrise-v1-glass-skyscrapers-01_bundle", "highrise-v1-glass-skyscrapers-01", "emissive-A_4K", "diffuse_4K"),
}
WALL_NAMES = {
    "osaka": ["light_ceramic_tile", "medium_concrete", "charcoal_ribbed_metal", "weathered_concrete"],
    "real_glass": ["raw_concrete", "white_panels", "ribbed_metal", "dark_slate"],
}


def period(profile, lo, hi):
    """First clear periodicity (px) of a 1D profile: the first autocorrelation local maximum
    in [lo, hi] above 0.25. None when the profile has no rhythm (e.g. ribbon windows)."""
    p = profile - profile.mean()
    ac = np.correlate(p, p, mode="full")[len(p) - 1:]
    if ac[0] <= 0:
        return None
    ac /= ac[0]
    for i in range(max(lo, 1), min(hi, len(ac) - 1)):
        if ac[i] > 0.25 and ac[i] >= ac[i - 1] and ac[i] >= ac[i + 1]:
            return i
    return None


def load(path, mode):
    return Image.open(path).convert(mode)


def main(src):
    src = Path(src)
    OUT.mkdir(parents=True, exist_ok=True)
    walls = []
    for name, (folder, stem, emissive, diffuse) in BUNDLES.items():
        d = src / folder
        layout = json.loads((d / f"{stem}_layout.json").read_text())
        facades = layout["facades"]
        rects = [f["rect"] if isinstance(f, dict) else f for f in facades]
        floors_hint = [f.get("floors") if isinstance(f, dict) else None for f in facades]
        mask = np.asarray(load(d / f"{stem}_window-mask_4K.png", "L"), dtype=np.float32) / 255.0
        W, H = mask.shape[1], mask.shape[0]

        info = []
        for i, (x0, y0, x1, y1) in enumerate(rects):
            m = mask[y0:y1, x0:x1]
            rows, cols = m.mean(axis=1), m.mean(axis=0)
            h, w = y1 - y0, x1 - x0
            if floors_hint[i]:
                floor_px = h / floors_hint[i]
            else:
                lo, hi = FLOOR_RANGE[name]
                floor_px = period(rows, 20, 400) or h / ((lo + hi) / 2)
                while h / floor_px > hi:
                    floor_px *= 2
                while h / floor_px < lo:
                    floor_px /= 2
            bay_px = period(cols, 24, 400) or w
            wrap_w = max(bay_px, int(w // bay_px) * bay_px)
            wrap_h = max(floor_px, int((y1 - y0) // floor_px) * floor_px)
            info.append({
                "rect": [x0 / W, y0 / H, x1 / W, y1 / H],
                "floor": floor_px / H,
                "bay": bay_px / W,
                "wrap": [wrap_w / W, wrap_h / H],
                "floors": round((y1 - y0) / floor_px, 1),
            })

        out = OUT / name
        out.mkdir(exist_ok=True)
        diff = load(d / f"{stem}_{diffuse}.png", "RGB").resize((SIZE, SIZE), Image.LANCZOS)
        rough = load(d / f"{stem}_roughness_4K.png", "L").resize((SIZE, SIZE), Image.LANCZOS)
        Image.merge("RGBA", (*diff.split(), rough)).save(out / "diffuse_rough.webp", quality=88, method=6, exact=True)
        load(d / f"{stem}_{emissive}.png", "RGB").resize((SIZE, SIZE), Image.LANCZOS).save(out / "emissive.webp", quality=90, method=6)
        load(d / f"{stem}_normal-OpenGL_4K.png", "RGB").resize((SIZE, SIZE), Image.LANCZOS).save(out / "normal.webp", quality=92, method=6)
        (OUT / f"{name}.json").write_text(json.dumps({"source": f"{folder}/{stem}", "facades": info}, indent=2) + "\n")
        print(name, [(round(f["floors"], 1), round(f["bay"] * W)) for f in info])

        if name in WALL_NAMES:
            full_d = load(d / f"{stem}_{diffuse}.png", "RGB")
            full_r = load(d / f"{stem}_roughness_4K.png", "L")
            mats = layout.get("materials") or layout.get("material_rects")
            for (x0, y0, x1, y1), wname in zip(mats, WALL_NAMES[name]):
                box = (x0 + 8, y0 + 8, x1 - 8, y1 - 8)
                walls.append((wname, full_d.crop(box).resize((512, 512), Image.LANCZOS), full_r.crop(box).resize((512, 512), Image.LANCZOS)))

    atlas = Image.new("RGBA", (2048, 1024))
    names = []
    for i, (wname, dimg, rimg) in enumerate(walls[:8]):
        atlas.paste(Image.merge("RGBA", (*dimg.split(), rimg)), ((i % 4) * 512, (i // 4) * 512))
        names.append(wname)
    atlas.save(OUT / "walls.webp", quality=88, method=6, exact=True)
    (OUT / "walls.json").write_text(json.dumps({"grid": [4, 2], "cells": names}, indent=2) + "\n")
    print("walls", names)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/Users/jankoprester/Projects/3d-modeling/blender/textures/generated-textures/generated-texture-atlas")
