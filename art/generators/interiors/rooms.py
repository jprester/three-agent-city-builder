"""Room cards seen through lit windows (see tools/blender/render_interiors.py).

A room is a W x D x H box seen from its open front: x across (0..W), y away from the window
(0 at the window plane, D at the back wall), z up. generate(ctx) furnishes one room of kind
ctx.p("kind") from ctx.rng and lights it. The facade shader ray-casts the same box behind
every window and projects the hit through the card camera, so walls, floor, ceiling and
furniture all get parallax from one image.

Residential rooms follow the old-core references: small, full, fluorescent tubes or a bare
bulb, a TV glow, clothes on a rack, a red altar lamp. Office rooms are deeper, wider (they
span several window cells) and lit by ceiling panels.

Lights are baked in a neutral white; the runtime tints each window with its own light colour.
All tunables are def params (art/interiors/interiors.json)."""
import bpy

from lib.materials import material
from lib.mesh import MeshBuilder

RESIDENTIAL = ("living", "bedroom", "kitchen", "storage", "study")
OFFICE = ("open_plan", "meeting", "racks", "vacant", "lounge")


def _mat(ctx, base, rough=0.8, emission=None, strength=0.0):
    name = f"I_{base}_{rough}_{emission}_{strength}"
    return material(ctx, name, base, roughness=rough, emission=emission, emission_strength=strength)


def _shell(mb, W, D, H, wall, floor, ceil):
    """Back wall, side walls, floor and ceiling, facing into the room."""
    mb.quad([(0, 0, 0), (W, 0, 0), (W, D, 0), (0, D, 0)], floor)
    mb.quad([(0, 0, H), (0, D, H), (W, D, H), (W, 0, H)], ceil)
    mb.quad([(0, D, 0), (W, D, 0), (W, D, H), (0, D, H)], wall)
    mb.quad([(0, 0, 0), (0, D, 0), (0, D, H), (0, 0, H)], wall)
    mb.quad([(W, D, 0), (W, 0, 0), (W, 0, H), (W, D, H)], wall)


def _light(kind, loc, energy, size=0.2, size_y=None, name="L"):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = (1.0, 1.0, 1.0)
    if kind == "AREA":
        data.shape = "RECTANGLE"
        data.size, data.size_y = size, size_y if size_y is not None else size
    else:
        data.shadow_soft_size = size
    obj = bpy.data.objects.new(name, data)
    obj.visible_camera = False   # the tube / panel geometry is what the card shows
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)


def _chair(mb, x, y, mat, facing=1):
    """Seat, thin back and a stem; facing +1: back toward the window (sitter faces away)."""
    mb.box(x, x + 0.45, y, y + 0.45, 0.42, 0.5, mat, skip=("bottom",))
    by = y if facing > 0 else y + 0.39
    mb.box(x + 0.03, x + 0.42, by, by + 0.06, 0.5, 0.95, mat)
    mb.box(x + 0.2, x + 0.25, y + 0.2, y + 0.25, 0.0, 0.42, mat)


def _clutter(ctx, mb, x0, x1, y0, y1, z, n, mats, hmax=0.35):
    """n small boxes (boxes, books, bags) on a surface."""
    rng = ctx.rng
    for _ in range(n):
        w, d, h = rng.uniform(0.12, 0.4), rng.uniform(0.12, 0.35), rng.uniform(0.08, hmax)
        x = rng.uniform(x0, max(x0, x1 - w))
        y = rng.uniform(y0, max(y0, y1 - d))
        mb.box(x, x + w, y, y + d, z, z + h, rng.choice(mats), skip=("bottom",))


def _back_wall(ctx, mb, W, D, wood, bits):
    """What a window shows head-on: the back wall at window height. Posters and a calendar,
    a wall shelf of things, sometimes a doorway into a dimmer room beyond."""
    rng = ctx.rng
    taken = []

    def free(x0, x1):
        return all(x1 < a - 0.1 or x0 > b + 0.1 for a, b in taken)
    if rng.random() < ctx.p("doorway_chance", 0.45):
        dx = rng.uniform(0.2, W - 1.0)
        beyond = rng.choice([_mat(ctx, "metal_dark", 0.9), _mat(ctx, "concrete_dark", 0.9, "tungsten", ctx.p("beyond_strength", 0.6))])
        mb.box(dx, dx + 0.8, D - 0.02, D, 0, 2.0, beyond)
        mb.box(dx - 0.06, dx + 0.86, D - 0.04, D, 2.0, 2.08, wood)
        taken.append((dx, dx + 0.8))
    for _ in range(rng.randint(1, 3)):
        w, h = rng.uniform(0.3, 0.7), rng.uniform(0.4, 0.8)
        x = rng.uniform(0.15, W - w - 0.15)
        if not free(x, x + w):
            continue
        z = rng.uniform(1.1, 2.3 - h)
        mb.box(x, x + w, D - 0.02, D, z, z + h, rng.choice(bits + [_mat(ctx, "sign_red", 0.8), _mat(ctx, "interior_white", 0.7)]))
        taken.append((x, x + w))
    if rng.random() < 0.7:
        w = rng.uniform(0.8, 1.4)
        x = rng.uniform(0.1, W - w - 0.1)
        z = rng.uniform(1.3, 1.65)
        mb.box(x, x + w, D - 0.28, D, z, z + 0.03, wood)
        _clutter(ctx, mb, x, x + w, D - 0.26, D - 0.02, z + 0.03, rng.randint(3, 7), bits, 0.3)


def _residential(ctx, mb, W, D, H):
    rng = ctx.rng
    kind = ctx.p("kind", "living")
    wall = _mat(ctx, rng.choice(["paint_cream", "paint_mint", "paint_blue", "paint_salmon", "interior_white"]), 0.9)
    floor = _mat(ctx, rng.choice(["interior_wood", "tile_stained", "interior_wood"]), 0.6)
    ceil = _mat(ctx, "interior_white", 0.9)
    _shell(mb, W, D, H, wall, floor, ceil)
    wood = _mat(ctx, "interior_wood", 0.6)
    fabric = _mat(ctx, rng.choice(["interior_fabric", "paint_salmon", "paint_blue"]), 0.95)
    white = _mat(ctx, "interior_white", 0.5)
    dark = _mat(ctx, "metal_dark", 0.4)
    bits = [_mat(ctx, c, 0.8) for c in ("paint_salmon", "paint_mint", "paint_cream", "interior_fabric", "sign_amber", "paint_blue")]
    tv = _mat(ctx, "metal_dark", 0.3, "tv_blue", ctx.p("tv_strength", 2.5))
    screen = _mat(ctx, "metal_dark", 0.3, "fluorescent", ctx.p("screen_strength", 2.0))

    if kind == "living":
        # TV cabinet on the back wall, sofa along a side wall, a rug and a low table.
        cx = rng.uniform(0.6, W - 1.8)
        mb.box(cx, cx + 1.4, D - 0.45, D, 0, 0.5, wood, skip=("bottom",))
        on = rng.random() < ctx.p("tv_chance", 0.5)
        mb.box(cx + 0.15, cx + 1.25, D - 0.12, D - 0.05, 0.6, 1.25, tv if on else dark, skip=("bottom",))
        _clutter(ctx, mb, cx, cx + 1.4, D - 0.4, D - 0.1, 0.5, 3, bits, 0.25)
        side = rng.choice((0, 1))
        sx0, sx1 = (0.0, 0.85) if side == 0 else (W - 0.85, W)
        sy = rng.uniform(0.8, max(0.9, D - 2.4))
        mb.box(sx0, sx1, sy, sy + 1.9, 0, 0.45, fabric, skip=("bottom",))
        bx0, bx1 = (sx0, sx0 + 0.22) if side == 0 else (sx1 - 0.22, sx1)
        mb.box(bx0, bx1, sy, sy + 1.9, 0.45, 0.85, fabric, skip=("bottom",))
        mb.box(W * 0.3, W * 0.7, D * 0.35, D * 0.65, 0, 0.01, _mat(ctx, rng.choice(["paint_salmon", "interior_carpet"]), 1.0))
        mb.box(W * 0.38, W * 0.62, D * 0.42, D * 0.58, 0, 0.4, wood, skip=("bottom",))
        # Shelves high on the back wall; sometimes the red altar lamp of an old flat.
        sx = rng.uniform(0.2, W - 1.2)
        mb.box(sx, sx + 1.0, D - 0.3, D, 1.75, 1.8, wood)
        _clutter(ctx, mb, sx, sx + 1.0, D - 0.28, D - 0.02, 1.8, 4, bits, 0.3)
        if rng.random() < ctx.p("altar_chance", 0.3):
            altar = _mat(ctx, "sign_red", 0.5, "sign_red", ctx.p("altar_strength", 6.0))
            ax = rng.uniform(0.3, W - 0.7)
            mb.box(ax, ax + 0.4, D - 0.35, D, 1.95, 2.0, wood)
            mb.box(ax + 0.1, ax + 0.3, D - 0.2, D - 0.1, 2.0, 2.15, altar)
    elif kind == "bedroom":
        bx = rng.uniform(0.0, W - 1.6)
        mb.box(bx, bx + 1.5, D - 2.0, D, 0, 0.5, white, skip=("bottom",))
        mb.box(bx + 0.05, bx + 1.45, D - 2.0, D - 1.2, 0.5, 0.6, fabric, skip=("bottom",))   # duvet
        mb.box(bx, bx + 1.5, D - 0.08, D, 0.5, 1.1, wood, skip=("bottom",))                 # headboard
        side = 0 if bx > W / 2 else 1
        wx0, wx1 = (0.0, 0.6) if side == 0 else (W - 0.6, W)
        wy = rng.uniform(0.6, 1.2)
        mb.box(wx0, wx1, wy, D - 2.1, 0, 2.1, wood, skip=("bottom",))                          # wardrobe
        _clutter(ctx, mb, wx0 + 0.02, wx1 - 0.02, wy + 0.05, D - 2.15, 2.1, 4, bits, 0.4)    # boxes on top
        if rng.random() < ctx.p("rack_chance", 0.5):
            # Clothes on a rack by the window: the Hong Kong flat silhouette.
            ry = rng.uniform(0.5, 1.0)
            mb.box(0.3, W - 0.3, ry, ry + 0.04, 1.75, 1.79, dark)
            x = 0.4
            while x < W - 0.5:
                w = rng.uniform(0.15, 0.4)
                mb.box(x, x + w, ry - 0.08, ry + 0.12, rng.uniform(0.9, 1.3), 1.75, rng.choice(bits), skip=("top",))
                x += w + rng.uniform(0.02, 0.15)
        lamp = _mat(ctx, "interior_white", 0.5, "tungsten", ctx.p("lamp_strength", 8.0))
        lx = bx - 0.45 if bx > 0.5 else bx + 1.6
        mb.box(lx, lx + 0.4, D - 0.45, D - 0.05, 0, 0.5, wood, skip=("bottom",))
        mb.box(lx + 0.12, lx + 0.28, D - 0.33, D - 0.17, 0.5, 0.75, lamp)
    elif kind == "kitchen":
        mb.box(0.0, W, D - 0.6, D, 0, 0.88, white, skip=("bottom",))
        mb.box(0.0, W, D - 0.62, D, 0.88, 0.92, _mat(ctx, "concrete", 0.3))
        mb.box(0.0, W, D - 0.35, D, 1.5, 2.2, rng.choice([white, wood]), skip=())
        _clutter(ctx, mb, 0.1, W - 0.1, D - 0.55, D - 0.1, 0.92, 7, bits, 0.3)
        fx = rng.choice((0.0, W - 0.7))
        mb.box(fx, fx + 0.7, D - 1.4, D - 0.65, 0, 1.8, white, skip=("bottom",))           # fridge
        mb.box(W * 0.3, W * 0.7, D * 0.3, D * 0.55, 0.7, 0.74, wood)                          # table top
        for tx, ty in ((W * 0.32, D * 0.32), (W * 0.66, D * 0.32), (W * 0.32, D * 0.51), (W * 0.66, D * 0.51)):
            mb.box(tx, tx + 0.04, ty, ty + 0.04, 0, 0.7, wood)
    elif kind == "storage":
        for x0 in (0.0, W - 0.5):
            mb.box(x0, x0 + 0.5, 0.8, D, 0, 2.2, dark, skip=("bottom",))
            for z in (0.4, 0.95, 1.5, 2.05):
                _clutter(ctx, mb, x0 + 0.02, x0 + 0.48, 0.85, D - 0.05, z, 6, bits, 0.45)
        _clutter(ctx, mb, 0.7, W - 0.7, D * 0.4, D - 0.1, 0, 10, bits, 0.6)
    else:  # study
        dx = rng.uniform(0.2, W - 1.6)
        mb.box(dx, dx + 1.3, D - 0.65, D, 0.72, 0.76, wood)
        for lx in (dx + 0.03, dx + 1.23):
            mb.box(lx, lx + 0.04, D - 0.6, D - 0.05, 0, 0.72, dark)
        mb.box(dx + 0.35, dx + 0.95, D - 0.25, D - 0.2, 0.85, 1.25, screen, skip=("bottom",))
        _chair(mb, dx + 0.42, D - 1.15, dark)
        side = 0 if dx > W / 2 else 1
        bx0, bx1 = (0.0, 0.35) if side == 0 else (W - 0.35, W)
        mb.box(bx0, bx1, 0.9, D - 0.8, 0, 2.0, wood, skip=("bottom",))
        for z in (0.35, 0.75, 1.15, 1.55):
            y = 0.95
            while y < D - 0.9:
                d = rng.uniform(0.03, 0.08)
                mb.box(bx0 + 0.02, bx1 - 0.02, y, y + d, z, z + rng.uniform(0.2, 0.32), rng.choice(bits), skip=("bottom",))
                y += d + 0.005

    _back_wall(ctx, mb, W, D, wood, bits)

    # Old flats are full: bags, boxes and a fan along the walls.
    if kind != "storage":
        _clutter(ctx, mb, 0.05, 0.6, 0.3, D * 0.6, 0, rng.randint(1, 4), bits, 0.5)
        _clutter(ctx, mb, W - 0.6, W - 0.05, 0.3, D * 0.6, 0, rng.randint(1, 4), bits, 0.5)

    # Ceiling light: a bare tube (most old flats) or a bulb.
    if rng.random() < ctx.p("tube_chance", 0.6):
        tube = _mat(ctx, "interior_white", 0.5, "fluorescent", ctx.p("tube_strength", 12.0))
        ty = D * rng.uniform(0.35, 0.6)
        mb.box(W * 0.3, W * 0.7, ty - 0.03, ty + 0.03, H - 0.06, H, tube)
        _light("AREA", (W / 2, ty, H - 0.08), ctx.p("tube_energy", 90.0), W * 0.4, 0.1)
    else:
        bulb = _mat(ctx, "interior_white", 0.5, "tungsten", ctx.p("bulb_strength", 20.0))
        bx, by = W * rng.uniform(0.35, 0.65), D * rng.uniform(0.35, 0.6)
        mb.box(bx - 0.06, bx + 0.06, by - 0.06, by + 0.06, H - 0.35, H - 0.23, bulb)
        _light("POINT", (bx, by, H - 0.4), ctx.p("bulb_energy", 70.0), 0.1)
        if rng.random() < ctx.p("fan_chance", 0.6):
            # Ceiling fan beside the bulb: the view from the street is mostly ceiling.
            fx, fy = (bx + 0.9 if bx < W / 2 else bx - 0.9), by + rng.uniform(-0.3, 0.3)
            mb.box(fx - 0.03, fx + 0.03, fy - 0.03, fy + 0.03, H - 0.3, H, dark)
            mb.box(fx - 0.6, fx + 0.6, fy - 0.07, fy + 0.07, H - 0.33, H - 0.3, wood)
            mb.box(fx - 0.07, fx + 0.07, fy - 0.6, fy + 0.6, H - 0.33, H - 0.3, wood)


def _office(ctx, mb, W, D, H):
    rng = ctx.rng
    kind = ctx.p("kind", "open_plan")
    wall = _mat(ctx, rng.choice(["interior_white", "interior_desk", "paint_blue"]), 0.9)
    floor = _mat(ctx, rng.choice(["interior_carpet", "interior_carpet", "concrete_dark"]), 0.95)
    ceil = _mat(ctx, "interior_white", 0.9)
    _shell(mb, W, D, H, wall, floor, ceil)
    desk = _mat(ctx, "interior_desk", 0.5)
    dark = _mat(ctx, "metal_dark", 0.4)
    fabric = _mat(ctx, "interior_fabric", 0.95)
    white = _mat(ctx, "interior_white", 0.4)
    screen = _mat(ctx, "metal_dark", 0.3, "fluorescent", ctx.p("screen_strength", 2.5))
    bits = [_mat(ctx, c, 0.8) for c in ("paint_salmon", "paint_mint", "interior_white", "interior_fabric", "sign_amber")]

    if kind == "open_plan":
        # Rows of desks across the floor, monitors facing the window or away.
        y = 1.2
        while y < D - 1.2:
            x = 0.3
            while x < W - 1.3:
                mb.box(x, x + 1.4, y, y + 0.75, 0.72, 0.75, desk)
                mb.box(x + 0.02, x + 0.06, y, y + 0.75, 0, 0.72, dark)
                if rng.random() < 0.75:
                    on = rng.random() < 0.6
                    mb.box(x + 0.45, x + 0.95, y + 0.55, y + 0.6, 0.8, 1.15, screen if on else dark, skip=("bottom",))
                if rng.random() < 0.7:
                    _chair(mb, x + 0.48 + rng.uniform(-0.1, 0.1), y - 0.55, fabric)
                _clutter(ctx, mb, x + 0.1, x + 1.3, y + 0.05, y + 0.5, 0.75, 2, bits, 0.15)
                x += 1.55
            mb.box(0.3, W - 0.3, y + 0.75, y + 0.8, 0.75, 1.2, fabric)   # low partition
            y += rng.uniform(2.0, 2.6)
        for x in range(int(W // 0.5)):
            mb.box(x * 0.5, x * 0.5 + 0.45, D - 0.45, D, 0, 1.3, dark if x % 3 else white, skip=("bottom",))   # files
    elif kind == "meeting":
        mb.box(W * 0.2, W * 0.8, D * 0.3, D * 0.7, 0.72, 0.76, desk)
        for k in range(6):
            cx = W * (0.25 + 0.1 * k)
            for cy, facing in ((D * 0.3 - 0.5, 1), (D * 0.7 + 0.05, -1)):
                _chair(mb, cx, cy, fabric, facing)
        mb.box(W * 0.3, W * 0.7, D - 0.05, D, 1.0, 2.1, white)                       # whiteboard
        if rng.random() < 0.5:
            mb.box(0.0, 0.06, D * 0.4, D * 0.6, 1.1, 1.8, screen)                     # wall screen
    elif kind == "racks":
        led = _mat(ctx, "metal_dark", 0.3, "sign_cyan", ctx.p("led_strength", 4.0))
        x = 0.5
        while x < W - 0.8:
            mb.box(x, x + 0.6, 1.5, D - 0.8, 0, 2.1, dark, skip=("bottom",))
            for _ in range(10):
                z, yy = rng.uniform(0.2, 2.0), rng.uniform(1.6, D - 1.0)
                mb.box(x - 0.01, x, yy, yy + 0.05, z, z + 0.02, led)
            x += 1.5
    elif kind == "vacant":
        for cx in (W * 0.33, W * 0.67):
            mb.box(cx - 0.3, cx + 0.3, D * 0.5 - 0.3, D * 0.5 + 0.3, 0, H, white, skip=("bottom", "top"))   # columns
        _clutter(ctx, mb, 0.5, W - 0.5, D * 0.6, D - 0.2, 0, 6, [_mat(ctx, "interior_wood", 0.9)], 0.6)
    else:  # lounge / reception
        mb.box(W * 0.35, W * 0.65, D - 1.6, D - 1.0, 0, 1.05, desk, skip=("bottom",))  # counter
        mb.box(0.0, W, D - 0.1, D, 0.0, H, _mat(ctx, rng.choice(["interior_wood", "paint_mint"]), 0.7))
        for sx in (W * 0.1, W * 0.75):
            mb.box(sx, sx + 1.0, 1.2, 1.9, 0, 0.42, fabric, skip=("bottom",))
            mb.box(sx, sx + 1.0, 1.75, 1.9, 0.42, 0.8, fabric, skip=("bottom",))
        plant = _mat(ctx, "paint_mint", 0.9)
        for px in (0.3, W - 0.6):
            mb.box(px, px + 0.3, D - 0.5, D - 0.2, 0, 0.45, dark, skip=("bottom",))
            mb.box(px - 0.1, px + 0.4, D - 0.6, D - 0.1, 0.45, 1.3, plant)

    # Ceiling panels in a grid, a few switched off.
    panel = _mat(ctx, "interior_white", 0.5, "fluorescent", ctx.p("panel_strength", 9.0))
    off = _mat(ctx, "interior_white", 0.7)
    pitch = ctx.p("panel_pitch", 1.8)
    y = pitch * 0.6
    while y < D - 0.3:
        x = pitch * 0.5
        while x < W - 0.3:
            lit = rng.random() < 0.85
            mb.box(x - 0.3, x + 0.3, y - 0.3, y + 0.3, H - 0.02, H, panel if lit else off)
            if lit:
                _light("AREA", (x, y, H - 0.04), ctx.p("panel_energy", 30.0), 0.6, 0.6)
            x += pitch
        y += pitch


def generate(ctx):
    """Build one room; returns nothing, the renderer frames it with the card camera."""
    W, D, H = ctx.p("width", 3.2), ctx.p("depth", 3.6), ctx.p("height", 2.7)
    mb = MeshBuilder(ctx.name)
    if ctx.p("kind", "living") in OFFICE:
        _office(ctx, mb, W, D, H)
    else:
        _residential(ctx, mb, W, D, H)
    mb.finish()
