"""Pack baked facade maps (tools/blender/bake_facades.py, build/facades/<bundle>/<style>/) into a tower
bundle in the same format as the photo bundles: art/textures/facades/<name>/{diffuse_rough,
emissive,normal}.webp at 2048², and art/textures/facades/<name>.json (rect, grid, floor, bay,
wrap per facade, exact: nothing is measured).

  python3 tools/textures/pack_facades.py art/facades/<bundle>.json build/facades/<bundle> <bundle>

Per style, in its cell of the 4x2 atlas (as the photo bundles: 464x976 rects at +24 px):
  diffuse_rough  albedo x ambient occlusion x grime, roughness in alpha (linear; non-glass
                 floored to matte, so only the panes reflect)
  normal         the baked world normal turned to tangent space (x right, y up, OpenGL)
  emissive       lit rooms in a share of the windows: office room cards (art/textures/interiors)
                 cropped to the window, warm or cool, under lit blinds where a blind is drawn;
                 only where the glass mask says glass, so nothing lights a frame or a wall
Grime (soft patches and rain streaks under the sills) is noise that wraps on the facade's grid,
so the runtime's wrap shows no seam. Deterministic: the style's seed drives everything.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SIZE = 2048
LIT_SHARE = 0.38
WALL_ROUGH_MIN = 0.68   # roughness floor of everything that is not glass (see main)


def lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def srgb(a):
    a = np.clip(a, 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def load(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


def periodic_noise(rng, h, w, scale_y, scale_x):
    """Smooth noise that wraps on an h x w grid: white noise low-passed in the frequency domain
    (a Gaussian of the given feature sizes in px), normalised to 0..1."""
    n = rng.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None] * scale_y
    fx = np.fft.fftfreq(w)[None, :] * scale_x
    f = np.real(np.fft.ifft2(np.fft.fft2(n) * np.exp(-(fy ** 2 + fx ** 2) * 8.0)))
    return (f - f.min()) / max(float(f.max() - f.min()), 1e-6)


def grime(rng, layout, style):
    """Darkening factor over the cell (1 = clean), periodic on the grid."""
    ch_, cw_ = layout["cell"][1], layout["cell"][0]
    gx0, gy0, gx1, gy1 = layout["grid"]
    gw, gh = int(round(gx1 - gx0)), int(round(gy1 - gy0))
    patches = periodic_noise(rng, gh, gw, 40, 40)
    streak_noise = periodic_noise(rng, gh, gw, 4, 140)
    # Rain streaks run down from each sill, fading over ~1.2 m.
    under = np.zeros((gh, gw), dtype=np.float32)
    ppm = layout["ppm"]
    for w in layout["windows"]:
        x0, ytop, x1, ybot = w["px"]
        a, b = int(round(x0 - gx0)), int(round(x1 - gx0))
        y = int(round(ybot - gy0))
        run = int(1.2 * ppm)
        for k in range(run):
            yy = (y + 2 + k) % gh
            under[yy, max(a, 0):min(b, gw)] = np.maximum(under[yy, max(a, 0):min(b, gw)], 1.0 - k / run)
    concrete = style["wall"] == "concrete"
    g = 1.0 - (0.22 if concrete else 0.15) * patches - 0.45 * under * np.clip(streak_noise * 1.6 - 0.4, 0, 1)
    # Tile over the whole cell from the grid's origin.
    ys = (np.arange(ch_) - int(round(gy0))) % gh
    xs = (np.arange(cw_) - int(round(gx0))) % gw
    return g[ys[:, None], xs[None, :]]


def room_cards():
    """Room cards by interiors set (office, residential, ...)."""
    spec = json.loads((ROOT / "art" / "textures" / "interiors" / "interiors.json").read_text())
    img = Image.open(ROOT / "art" / "textures" / "interiors" / "interiors.webp").convert("RGB")
    return {name: [img.crop(tuple(t)) for t in s["tiles"]] for name, s in spec["sets"].items()}


def fit_card(card, w, h):
    """A room card cropped to a w x h window's aspect around its centre and resized (linear RGB),
    its brightest 2 % at most 0.75 so a white room does not blow out under bloom."""
    cw, chh = card.size
    aspect = w / h
    if cw / chh > aspect:
        nw = int(chh * aspect)
        card = card.crop(((cw - nw) // 2, 0, (cw - nw) // 2 + nw, chh))
    else:
        nh = int(cw / aspect)
        card = card.crop((0, (chh - nh) // 2, cw, (chh - nh) // 2 + nh))
    room = lin(np.asarray(card.resize((w, h), Image.LANCZOS), dtype=np.float32) / 255.0)
    return room * min(1.0, 0.75 / max(float(np.percentile(room.mean(axis=2), 98)), 1e-3))


def interiors_by_day(rng, layout, glass, blind, cards):
    """What daylight shows through the glass of every window: the room, faint (linear RGB, added to
    the albedo), not where a blind or curtain covers it."""
    ch_, cw_ = layout["cell"][1], layout["cell"][0]
    out = np.zeros((ch_, cw_, 3), dtype=np.float32)
    for w in layout["windows"]:
        x0, y0, x1, y1 = (int(round(v)) for v in w["px"])
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        out[y0:y1, x0:x1] = fit_card(cards[rng.integers(len(cards))], x1 - x0, y1 - y0) * rng.uniform(0.05, 0.12)
    return out * glass[..., :1] * (1 - blind[..., :1])


def patches(rng, layout, h, w):
    """Repaired or re-pointed patches of wall: soft rectangles of slightly different tone, placed
    on the grid so they wrap with it (a multiplier, 1 = untouched)."""
    gx0, gy0, gx1, gy1 = layout["grid"]
    gw, gh = int(round(gx1 - gx0)), int(round(gy1 - gy0))
    tone = np.ones((gh, gw, 3), dtype=np.float32)
    for _ in range(int(gw * gh / 9000) + 3):
        pw, ph = int(rng.uniform(12, 60)), int(rng.uniform(10, 50))
        px, py = rng.integers(gw), rng.integers(gh)
        t = rng.uniform(0.86, 1.08) * np.array([1.0, rng.uniform(0.97, 1.02), rng.uniform(0.95, 1.03)])
        ys = (np.arange(py, py + ph) % gh)[:, None]
        xs = (np.arange(px, px + pw) % gw)[None, :]
        tone[ys, xs] = tone[ys, xs] * t
    ys = (np.arange(h) - int(round(gy0))) % gh
    xs = (np.arange(w) - int(round(gx0))) % gw
    return tone[ys[:, None], xs[None, :]]


def emissive(rng, layout, glass, blind, cards):
    """Lit rooms in the cell (linear RGB)."""
    ch_, cw_ = layout["cell"][1], layout["cell"][0]
    out = np.zeros((ch_, cw_, 3), dtype=np.float32)
    warm, cool = np.array([1.0, 0.82, 0.62]), np.array([0.9, 0.95, 1.0])
    for w in layout["windows"]:
        if rng.random() >= LIT_SHARE:
            continue
        x0, y0, x1, y1 = (int(round(v)) for v in w["px"])
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        room = fit_card(cards[rng.integers(len(cards))], x1 - x0, y1 - y0)
        tint = warm if rng.random() < 0.55 else cool
        # The shader lifts emission ~2x and bloom takes the rest: the rendered rooms are bright.
        gain = rng.uniform(0.4, 0.75)
        lit = room * tint * gain
        # A lit blind glows in the room's light, dimmer than the open glass, in slats.
        b = blind[y0:y1, x0:x1, :1]
        slats = 0.75 + 0.25 * np.sin(np.arange(y1 - y0) * 1.9)[:, None, None]
        lit = lit * (1 - b) + b * tint * gain * 0.35 * slats
        out[y0:y1, x0:x1] = lit
    return out * glass[..., :1]


def main(def_path, bake_dir, name="baked"):
    cfg = json.loads(Path(def_path).read_text())
    bake = Path(bake_dir)
    diff = np.zeros((SIZE, SIZE, 4), dtype=np.float32)
    norm = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    norm[...] = (0.5, 0.5, 1.0)
    emit = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    sets = room_cards()
    facades = []
    for i, style in enumerate(cfg["styles"]):
        src = bake / style["id"]
        layout = json.loads((src / "layout.json").read_text())
        rng = np.random.default_rng(style["seed"])
        cards = sets[style.get("rooms", "office")]
        cw_, ch_ = layout["cell"]
        x0, y0 = (i % 4) * 512 + 24, (i // 4) * 1024 + 24
        albedo = lin(load(src / "albedo.png"))
        ao = lin(load(src / "ao.png"))[..., :1]
        rough = lin(load(src / "rough.png"))[..., 0]
        glass = lin(load(src / "glass.png"))
        blind = lin(load(src / "blind.png"))
        n = lin(load(src / "normal.png")) * 2.0 - 1.0
        n /= np.linalg.norm(n, axis=2, keepdims=True) + 1e-6
        tangent = np.stack([n[..., 0], n[..., 2], -n[..., 1]], axis=2)

        g = grime(rng, layout, style)[..., None]
        wall = ((glass[..., :1] < 0.5) & (blind[..., :1] < 0.5)).astype(np.float32)
        tone = 1.0 + (patches(rng, layout, ch_, cw_) - 1.0) * wall
        base = albedo * tone + interiors_by_day(rng, layout, glass, blind, cards)
        diff[y0:y0 + ch_, x0:x0 + cw_, :3] = srgb(base * ao ** 0.8 * g)
        # Only glass reflects: the shader reads roughness below ~0.6 as glass (src/materials/facade.ts,
        # glassAmt), and glazed tile (0.45) or curtain-wall spandrel panels (0.15) mirrored the
        # sky like the windows. Everything the glass mask does not cover is floored to matte.
        g1 = glass[..., 0]
        diff[y0:y0 + ch_, x0:x0 + cw_, 3] = g1 * rough + (1.0 - g1) * np.maximum(rough, WALL_ROUGH_MIN)
        norm[y0:y0 + ch_, x0:x0 + cw_] = tangent * 0.5 + 0.5
        emit[y0:y0 + ch_, x0:x0 + cw_] = srgb(emissive(rng, layout, glass, blind, cards))

        gx0, gy0, gx1, gy1 = layout["grid"]
        rect = [x0 / SIZE, y0 / SIZE, (x0 + cw_) / SIZE, (y0 + ch_) / SIZE]
        grid = [(x0 + gx0) / SIZE, (y0 + gy0) / SIZE, (x0 + gx1) / SIZE, (y0 + gy1) / SIZE]
        facades.append({
            "style": style["id"], "rect": rect,
            "hint": [layout["floor"] / SIZE, layout["bay"] / SIZE],
            "floor": layout["floor"] / SIZE, "bay": layout["bay"] / SIZE,
            "grid": grid, "wrap": [grid[2] - grid[0], grid[3] - grid[1]],
            "floors": layout["floors"], "bays": layout["bays"], "ribbon": False,
        })
    out = ROOT / "art" / "textures" / "facades" / name
    out.mkdir(parents=True, exist_ok=True)
    to8 = lambda a: (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(to8(diff), "RGBA").save(out / "diffuse_rough.webp", quality=90, method=6, exact=True)
    Image.fromarray(to8(norm), "RGB").save(out / "normal.webp", quality=94, method=6)
    Image.fromarray(to8(emit), "RGB").save(out / "emissive.webp", quality=90, method=6)
    (out.parent / f"{name}.json").write_text(json.dumps({"source": f"art/facades/{name}.json (baked)", "facades": facades}, indent=2) + "\n")
    print(name, len(facades), "facades")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
