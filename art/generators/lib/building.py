"""Parts shared by the building families: walls on a box, flat roofs with parapets,
rooftop clutter. Everything is facade-shaded (lib/surface.py). Coordinates are Blender
building space: origin at the footprint center on the ground, front facing -Y."""
from lib.surface import facade_uv, fixture, plan_uv, surf
from lib.transforms import facade_width, facade_xf


def cell(ctx, kind):
    c = ctx.facade["cells"][kind]
    return c["w"], c["h"]


def offset(xf, cx, cy):
    """Compose a facade transform with a translation of the box center."""
    def f(x, y, z):
        px, py, pz = xf(x, y, z)
        return (px + cx, py + cy, pz)
    return f


def side_frame(side, W, D, cx=0.0, cy=0.0):
    """(facade width, transform) of side 0 front (-Y), 1 right, 2 back, 3 left of a W×D box."""
    return facade_width(side, W, D), offset(facade_xf(side, W, D), cx, cy)


def walls(mb, ctx, W, D, z0, z1, vbase, kinds, cx=0.0, cy=0.0):
    """Four walls of a W×D box between z0 and z1. kinds[side] = (kind, fill, tint)."""
    for side in range(4):
        fw, xf = side_frame(side, W, D, cx, cy)
        kind, fill, tint = kinds[side]
        m, s = surf(ctx, kind, fill, tint)
        mb.quad([(-fw / 2, 0, z0), (fw / 2, 0, z0), (fw / 2, 0, z1), (-fw / 2, 0, z1)], m, xf, s, facade_uv(fw, vbase))


def flat_roof(mb, ctx, W, D, z, tint, cx=0.0, cy=0.0, parapet=1.0, thick=0.25):
    """Roof slab plus a parapet wall around it."""
    m, s = surf(ctx, "roof", 0.0, tint)
    x0, x1, y0, y1 = cx - W / 2, cx + W / 2, cy - D / 2, cy + D / 2
    mb.quad([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], m, None, s, plan_uv)
    if parapet <= 0:
        return
    tm, ts = surf(ctx, "trim", 0.0, tint)
    t = thick
    for bx in ((x0, x1, y0, y0 + t), (x0, x1, y1 - t, y1), (x0, x0 + t, y0 + t, y1 - t), (x1 - t, x1, y0 + t, y1 - t)):
        mb.box(bx[0], bx[1], bx[2], bx[3], z, z + parapet, tm, None, ("bottom",), ts, plan_uv)


def water_tank(mb, ctx, x, y, z, size):
    m, s = surf(ctx, "metal", 0.0, 0.3)
    legs = 0.6
    mb.box(x - size / 2, x + size / 2, y - size / 2, y + size / 2, z + legs, z + legs + size * 0.9, m, None, (), s, plan_uv)
    for dx in (-1, 1):
        for dy in (-1, 1):
            lx, ly = x + dx * size * 0.4, y + dy * size * 0.4
            mb.box(lx - 0.08, lx + 0.08, ly - 0.08, ly + 0.08, z, z + legs, m, None, ("bottom", "top"), s, plan_uv)


def stair_hut(mb, ctx, x, y, z, w, d, h, tint):
    """Roof access hut with a lit door lamp on its front (-Y) face."""
    m, s = surf(ctx, "trim", 0.0, tint)
    mb.box(x - w / 2, x + w / 2, y - d / 2, y + d / 2, z, z + h, m, None, ("bottom",), s, plan_uv)
    fm, fs = fixture(ctx, "white")
    yy = y - d / 2 - 0.02
    mb.quad([(x - 0.25, yy, z + h - 0.7), (x + 0.25, yy, z + h - 0.7), (x + 0.25, yy, z + h - 0.45), (x - 0.25, yy, z + h - 0.45)], fm, None, fs, plan_uv)


def ac_cluster(mb, ctx, x, y, z, n):
    m, s = surf(ctx, "metal", 0.0, 0.6)
    for k in range(n):
        ux = x + (k - (n - 1) / 2) * 1.2
        mb.box(ux - 0.5, ux + 0.5, y - 0.4, y + 0.4, z, z + 0.9, m, None, ("bottom",), s, plan_uv)


def mast(mb, ctx, x, y, z, h, red=True):
    """Antenna mast with a light at the top (red aviation light or sodium work light)."""
    m, s = surf(ctx, "metal", 0.0, 0.0)
    mb.box(x - 0.07, x + 0.07, y - 0.07, y + 0.07, z, z + h, m, None, ("bottom",), s, plan_uv)
    fm, fs = fixture(ctx, "red" if red else "sodium")
    mb.box(x - 0.18, x + 0.18, y - 0.18, y + 0.18, z + h, z + h + 0.3, fm, None, ("bottom",), fs, plan_uv)


def roof_clutter(mb, ctx, W, D, z, tint, density=1.0, cx=0.0, cy=0.0, margin=1.2):
    """Scatter tanks, huts, AC clusters and masts over a W×D roof on a coarse grid, so
    pieces never overlap. Returns the tallest point added."""
    rng = ctx.rng
    top = z
    step = 4.2
    nx, ny = max(1, int((W - 2 * margin) // step)), max(1, int((D - 2 * margin) // step))
    slots = [(i, j) for i in range(nx) for j in range(ny)]
    rng.shuffle(slots)
    ox, oy = cx - (nx - 1) * step / 2, cy - (ny - 1) * step / 2
    hut = False
    for i, j in slots[: max(1, int(len(slots) * 0.35 * density))]:
        x, y = ox + i * step, oy + j * step
        r = rng.random()
        if not hut and W > 8:
            stair_hut(mb, ctx, x, y, z, 3.0, 2.6, 2.8, tint)
            hut, top = True, max(top, z + 2.8)
        elif r < 0.3:
            size = rng.uniform(1.8, 2.8)
            water_tank(mb, ctx, x, y, z, size)
            top = max(top, z + 0.6 + size)
        elif r < 0.75:
            ac_cluster(mb, ctx, x, y, z, rng.randint(1, 3))
            top = max(top, z + 0.9)
        elif r < 0.9:
            h = rng.uniform(4, 11)
            mast(mb, ctx, x, y, z, h, red=h > 8)
        # else: leave the slot empty
    return top


def aviation_lights(mb, ctx, W, D, z, cx=0.0, cy=0.0):
    """Red obstruction lights on the four roof corners (almost every tall roof has them)."""
    fm, fs = fixture(ctx, "red")
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = cx + sx * (W / 2 - 0.4), cy + sy * (D / 2 - 0.4)
            mb.box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, z, z + 0.4, fm, None, ("bottom",), fs, plan_uv)


def corner_strips(mb, ctx, w, d, z0, z1, color, cx=0.0, cy=0.0, t=0.22):
    """Vertical LED strips on the four vertical edges of a w×d box."""
    fm, fs = fixture(ctx, color, strip=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = cx + sx * w / 2, cy + sy * d / 2
            mb.box(x - t, x + t, y - t, y + t, z0, z1, fm, None, ("bottom", "top"), fs, plan_uv)


def face_stripes(mb, ctx, w, d, z0, z1, color, sides=(0, 2), n=2, cx=0.0, cy=0.0):
    """n vertical LED stripes on the given faces, standing just proud of the wall."""
    fm, fs = fixture(ctx, color, strip=True)
    for side in sides:
        fw, xf = side_frame(side, w, d, cx, cy)
        for k in range(n):
            u = -fw / 2 + (k + 1) * fw / (n + 1)
            mb.box(u - 0.15, u + 0.15, -0.25, 0.0, z0, z1, fm, xf, ("back", "bottom", "top"), fs, facade_uv(fw, z0))


def screen(mb, ctx, w, d, z0, z1, frac=0.6, side=0, cx=0.0, cy=0.0):
    """Video screen on a face: a quad 0.3 m off the wall with UVs normalized over the screen,
    plus a dark frame. Content is animated in the shader."""
    fw, xf = side_frame(side, w, d, cx, cy)
    sw = fw * frac
    x0, x1 = -sw / 2, sw / 2
    sm, ss = surf(ctx, "screen", ctx.rng.random(), ctx.rng.random())

    def uvn(pts, n):
        return [((x - x0) / sw, (z - z0) / (z1 - z0)) for x, y, z in pts]
    mm, ms = surf(ctx, "metal", 0.0, 0.1)
    mb.box(x0 - 0.4, x1 + 0.4, -0.3, 0.0, z0 - 0.4, z1 + 0.4, mm, xf, ("back",), ms, facade_uv(fw, z0))
    mb.quad([(x0, -0.32, z0), (x1, -0.32, z0), (x1, -0.32, z1), (x0, -0.32, z1)], sm, xf, ss, uvn)
