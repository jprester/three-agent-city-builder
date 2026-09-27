"""Parts shared by the building families: walls on a box, flat roofs with parapets,
rooftop clutter. Everything is facade-shaded (lib/surface.py). Coordinates are Blender
building space: origin at the footprint center on the ground, front facing -Y."""
from lib.surface import cols_of, facade_uv, fixture, plan_uv, surf
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
    """Four walls of a W×D box between z0 and z1. kinds[side] = (kind, fill, tint); for
    window kinds `fill` is an opening pattern (lib.surface.window_code)."""
    for side in range(4):
        fw, xf = side_frame(side, W, D, cx, cy)
        kind, fill, tint = kinds[side]
        m, s = surf(ctx, kind, fill, tint, cols_of(ctx, kind, fw))
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


def prism(mb, m, s, x, y, z0, z1, r, n=8, top=True, r_top=None):
    """Vertical n-sided prism (a cheap cylinder), optionally tapering to r_top, capped on top."""
    import math
    rt = r if r_top is None else r_top
    ring = [(math.cos(2 * math.pi * k / n), math.sin(2 * math.pi * k / n)) for k in range(n)]
    for k in range(n):
        (c0, s0), (c1, s1) = ring[k], ring[(k + 1) % n]
        mb.quad([(x + c0 * r, y + s0 * r, z0), (x + c1 * r, y + s1 * r, z0),
                 (x + c1 * rt, y + s1 * rt, z1), (x + c0 * rt, y + s0 * rt, z1)], m, None, s, plan_uv)
    if top and rt > 0.01:
        mb.quad([(x + c * rt, y + sn * rt, z1) for c, sn in ring], m, None, s, plan_uv)


def water_tank(mb, ctx, x, y, z, size):
    """Cylindrical tank on a braced steel stand, with a shallow conical lid: the rooftop
    silhouette of old Hong Kong."""
    rng = ctx.rng
    m, s = surf(ctx, "metal", 0.0, 0.3)
    tm, ts = surf(ctx, "trim", 0.0, rng.random())
    stand = rng.uniform(1.2, 3.2)
    r = size / 2
    h = size * rng.uniform(0.9, 1.3)
    leg = r * 0.75
    for dx in (-1, 1):
        for dy in (-1, 1):
            lx, ly = x + dx * leg, y + dy * leg
            mb.box(lx - 0.07, lx + 0.07, ly - 0.07, ly + 0.07, z, z + stand, m, None, ("bottom", "top"), s, plan_uv)
    # Cross braces at mid height and a platform ring under the tank.
    zb = z + stand * 0.5
    for dy in (-1, 1) if not ctx.p("lod", 0) else ():
        mb.box(x - leg, x + leg, y + dy * leg - 0.04, y + dy * leg + 0.04, zb - 0.04, zb + 0.04, m, None, (), s, plan_uv)
    for dx in (-1, 1) if not ctx.p("lod", 0) else ():
        mb.box(x + dx * leg - 0.04, x + dx * leg + 0.04, y - leg, y + leg, zb - 0.04, zb + 0.04, m, None, (), s, plan_uv)
    mb.box(x - r * 0.9, x + r * 0.9, y - r * 0.9, y + r * 0.9, z + stand, z + stand + 0.15, m, None, (), s, plan_uv)
    body = tm if rng.random() < 0.6 else m
    bs = ts if body is tm else s
    prism(mb, body, bs, x, y, z + stand + 0.15, z + stand + 0.15 + h, r, 8, top=False)
    prism(mb, body, bs, x, y, z + stand + 0.15 + h, z + stand + 0.45 + h, r, 8, r_top=r * 0.2)
    return z + stand + 0.45 + h


def antenna_cluster(mb, ctx, x, y, z):
    """Two to four masts of different heights with crossarms and small dishes; one may carry
    a red light. Returns the top."""
    rng = ctx.rng
    lod = ctx.p("lod", 0)
    m, s = surf(ctx, "metal", 0.0, 0.0)
    top = z
    for k in range(rng.randint(2, 4)):
        mx, my = x + rng.uniform(-1.2, 1.2), y + rng.uniform(-1.2, 1.2)
        h = rng.uniform(3.0, 12.0)
        mb.box(mx - 0.05, mx + 0.05, my - 0.05, my + 0.05, z, z + h, m, None, ("bottom",), s, plan_uv)
        for a in range(rng.randint(0, 3)):
            za = z + h * rng.uniform(0.5, 0.95)
            w = rng.uniform(0.6, 1.6)
            along_x = rng.random() < 0.5
            if lod:
                continue   # LOD: masts only (random draws kept so nothing else moves)
            if along_x:
                mb.box(mx - w, mx + w, my - 0.03, my + 0.03, za - 0.03, za + 0.03, m, None, (), s, plan_uv)
            else:
                mb.box(mx - 0.03, mx + 0.03, my - w, my + w, za - 0.03, za + 0.03, m, None, (), s, plan_uv)
        if rng.random() < 0.35:
            # Small dish: a thin tilted plate approximated by a box on an arm.
            zd = z + h * rng.uniform(0.3, 0.7)
            d = rng.uniform(0.35, 0.7)
            if not lod:
                mb.box(mx + 0.1, mx + 0.25, my - d, my + d, zd - d, zd + d, m, None, (), s, plan_uv)
        if h > 8 and rng.random() < 0.6:
            fm, fs = fixture(ctx, "red")
            mb.box(mx - 0.14, mx + 0.14, my - 0.14, my + 0.14, z + h, z + h + 0.25, fm, None, ("bottom",), fs, plan_uv)
        top = max(top, z + h)
    return top


def railing(mb, ctx, W, D, z, cx=0.0, cy=0.0, h=1.1, post=2.5):
    """Pipe railing on top of a parapet: a top rail and posts every `post` meters."""
    m, s = surf(ctx, "metal", 0.0, 0.2)
    x0, x1, y0, y1 = cx - W / 2 + 0.12, cx + W / 2 - 0.12, cy - D / 2 + 0.12, cy + D / 2 - 0.12
    t = 0.035
    for (ax, ay, bx, by) in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
        mb.box(min(ax, bx) - t, max(ax, bx) + t, min(ay, by) - t, max(ay, by) + t, z + h - t, z + h + t, m, None, (), s, plan_uv)
        L = max(abs(bx - ax), abs(by - ay))
        n = max(1, int(L // post))
        for k in range(n):
            px, py = ax + (bx - ax) * k / n, ay + (by - ay) * k / n
            mb.box(px - t, px + t, py - t, py + t, z, z + h, m, None, ("bottom", "top"), s, plan_uv)


def crane(mb, ctx, x, y, z, height, jib, angle=0.0):
    """Tower crane: lattice mast (a slim box), operator cab, jib and counter-jib with a
    counterweight, red lights at the tips. `angle` turns the jib (radians). Returns the top."""
    import math
    m, s = surf(ctx, "metal", 0.0, 0.8)
    fm, fs = fixture(ctx, "red")
    w = 0.9
    mb.box(x - w, x + w, y - w, y + w, z, z + height, m, None, ("bottom",), s, plan_uv)
    zt = z + height
    c, sn = math.cos(angle), math.sin(angle)

    def xf(px, py, pz):
        return (x + c * px - sn * py, y + sn * px + c * py, pz)
    mb.box(-1.2, 1.2, -1.0, 1.0, zt, zt + 2.0, m, xf, (), s, plan_uv)
    mb.box(-jib * 0.28, jib, -0.45, 0.45, zt + 2.0, zt + 3.0, m, xf, (), s, plan_uv)
    mb.box(-jib * 0.28, -jib * 0.18, -0.8, 0.8, zt + 0.6, zt + 2.0, m, xf, (), s, plan_uv)
    mb.box(-0.3, 0.3, -0.3, 0.3, zt + 3.0, zt + 6.5, m, xf, ("bottom",), s, plan_uv)
    for px in (jib - 0.3, -jib * 0.28 + 0.3):
        mb.box(px - 0.2, px + 0.2, -0.2, 0.2, zt + 3.0, zt + 3.35, fm, xf, ("bottom",), fs, plan_uv)
    mb.box(-0.2, 0.2, -0.2, 0.2, zt + 6.5, zt + 6.85, fm, xf, ("bottom",), fs, plan_uv)
    return zt + 6.85


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


def roof_clutter(mb, ctx, W, D, z, tint, density=1.0, cx=0.0, cy=0.0, margin=1.2, rail=None):
    """Scatter tanks on stands, huts, AC clusters, antenna clusters and masts over a W×D
    roof on a coarse grid, so pieces never overlap; optionally a railing on the parapet
    (`rail`: chance, default param "railing"). Returns the tallest point added."""
    rng = ctx.rng
    top = z
    step = 4.2 if W * D > 300 else 3.3   # small tenement roofs get a tighter grid
    nx, ny = max(1, int((W - 2 * margin) // step)), max(1, int((D - 2 * margin) // step))
    slots = [(i, j) for i in range(nx) for j in range(ny)]
    rng.shuffle(slots)
    ox, oy = cx - (nx - 1) * step / 2, cy - (ny - 1) * step / 2
    hut = False
    for i, j in slots[: max(1, int(round(len(slots) * 0.55 * density)))]:
        x, y = ox + i * step, oy + j * step
        r = rng.random()
        if not hut and W > 8 and len(slots) >= 3:
            stair_hut(mb, ctx, x, y, z, 3.0, 2.6, 2.8, tint)
            hut, top = True, max(top, z + 2.8)
        elif r < 0.3:
            top = max(top, water_tank(mb, ctx, x, y, z, rng.uniform(1.8, 2.8)))
        elif r < 0.6:
            ac_cluster(mb, ctx, x, y, z, rng.randint(1, 3))
            top = max(top, z + 0.9)
        elif r < 0.82:
            top = max(top, antenna_cluster(mb, ctx, x, y, z))
        elif r < 0.9:
            h = rng.uniform(4, 11)
            mast(mb, ctx, x, y, z, h, red=h > 8)
        # else: leave the slot empty
    if rng.random() < (ctx.p("railing", 0.5) if rail is None else rail) and not ctx.p("lod", 0):
        railing(mb, ctx, W, D, z + 1.0, cx, cy)
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
    # Exactly 2:3 (portrait ads fill it undistorted), anchored at the top z1.
    sw = min(fw * frac, (z1 - z0) / 1.5)
    z0 = z1 - sw * 1.5
    x0, x1 = -sw / 2, sw / 2
    sm, ss = surf(ctx, "screen", ctx.rng.random(), ctx.rng.random())

    def uvn(pts, n):
        return [((x - x0) / sw, (z - z0) / (z1 - z0)) for x, y, z in pts]
    mm, ms = surf(ctx, "metal", 0.0, 0.1)
    mb.box(x0 - 0.4, x1 + 0.4, -0.3, 0.0, z0 - 0.4, z1 + 0.4, mm, xf, ("back",), ms, facade_uv(fw, z0))
    mb.quad([(x0, -0.32, z0), (x1, -0.32, z0), (x1, -0.32, z1), (x0, -0.32, z1)], sm, xf, ss, uvn)
