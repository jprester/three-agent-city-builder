"""Suspended monorail car (Chiba style), length along +X, floor at z = 0, hung from the girder
by two hangers that reach `hanger_top` above the floor.

The hull is one rounded cross-section (underframe, skirt, window band, shoulders, roof) swept
along the car, broken by real openings: two recessed doors and four windows per side, through
which a lit interior shows (ceiling with light strips, linings, bench seats, passengers as
silhouettes). `end`: the car carries a tapered nose at +X (a loft of the same section,
narrowing and dropping, glazed round the shoulders as a wraparound windscreen), with head and
tail lamps and a destination display; otherwise both ends are gangways with bellows.

Facade-shaded: paint, glass and rubber are metal subtypes, the interior is the lit-interior
subtype (metal fill 0.1, src/materials/facade.ts), lamps are fixtures; one draw per car type."""
from lib.mesh import MeshBuilder
from lib.solids import Route, loft_x, prism_x
from lib.surface import fixture, surf
from vehicles.car import CAR_PAINTS


def _paint(ctx, name):
    return surf(ctx, "metal", 0.3, (CAR_PAINTS.index(name) + 0.5) / 12)


def _lit(kind, glow, ctx):
    return surf(ctx, "metal", 0.1, (kind + glow) / 4)


def _solid(a, b, holes):
    out, at = [], a
    for lo, hi in sorted(holes):
        if lo > at:
            out.append((at, min(lo, b)))
        at = max(at, hi)
    if b > at:
        out.append((at, b))
    return [(p, q) for p, q in out if q - p > 0.02]


def generate(ctx):
    rng = ctx.rng
    L, W, H = ctx.p("length", 14.5), ctx.p("width", 2.6), ctx.p("height", 2.9)
    SILL, HEAD, CEIL = ctx.p("sill", 0.85), ctx.p("head", 2.15), ctx.p("ceiling", 2.2)
    WALL, ENDW = ctx.p("wall", 0.14), ctx.p("end_wall", 0.12)
    doors, dw = ctx.p("doors", [-3.6, 3.6]), ctx.p("door_width", 1.3)
    gap = ctx.p("gap", 0.5)
    end = ctx.p("end", False)
    NOSE, SLICES = ctx.p("nose", 2.2), ctx.p("nose_slices", 10)
    hanger_top = ctx.p("hanger_top", 3.95)
    hw, hd = W / 2, dw / 2

    hull = _paint(ctx, ctx.p("paint", "car_white"))
    under = _paint(ctx, "car_grey")
    leaf = _paint(ctx, "car_silver")
    glass = surf(ctx, "metal", 0.5, 0.0)
    rubber = surf(ctx, "metal", 0.8, 0.0)
    strut_s = surf(ctx, "metal", 0.0, 0.4)
    lining, ceiling = _lit(0, 0.32, ctx), _lit(0, 0.6, ctx)
    fabric, carpet = _lit(1, 0.22, ctx), _lit(2, 0.14, ctx)
    tube = fixture(ctx, "white", strip=True)
    line = fixture(ctx, "cyan", strip=True)
    door_lamp = fixture(ctx, "sodium", lamp=True)
    head_lamp, tail_lamp = fixture(ctx, "white", lamp=True), fixture(ctx, "red", lamp=True)
    clothes = [_paint(ctx, n) for n in ("car_black", "car_navy", "car_grey", "car_beige")] + [rubber, rubber]

    mb = MeshBuilder(ctx.name)
    R = Route(mb)    # u = x, v = -y: the car's sides are v = +-hw

    # Cross-section, counter-clockwise in (y, z): lower part up to the sill, upper from the window head.
    lower = [(-hw, SILL), (-hw, 0.02), (-hw + 0.1, -0.2), (-hw + 0.32, -0.3), (hw - 0.32, -0.3), (hw - 0.1, -0.2), (hw, 0.02), (hw, SILL)]
    upper = [(hw, HEAD), (hw - 0.03, 2.45), (hw - 0.15, 2.72), (hw - 0.42, H), (-hw + 0.42, H), (-hw + 0.15, 2.72), (-hw + 0.03, 2.45), (-hw, HEAD)]
    x0, x1 = -L / 2, L / 2

    door_holes = [(d - hd, d + hd) for d in doors]
    d0, d1 = doors[0], doors[-1]
    windows = [(x0 + 0.65, d0 - hd - 0.35), (d0 + hd + 0.35, -0.2), (0.2, d1 - hd - 0.35), (d1 + hd + 0.35, x1 - 0.65)]
    piers = _solid(x0, x1, door_holes + windows)
    skirts = _solid(x0, x1, door_holes)

    # Hull: underframe and upper body run the full length; skirts stop at the doors.
    prism_x(mb, lower[1:7], x0, x1, under, caps=(False, False), closed=False)
    prism_x(mb, upper, x0, x1, hull, caps=(False, False), closed=False)
    for a, b in skirts:
        prism_x(mb, lower[6:8], a, b, hull, caps=(False, False), closed=False)
        prism_x(mb, lower[0:2], a, b, hull, caps=(False, False), closed=False)
    xi0, xi1 = x0 + ENDW, x1 - ENDW
    iv = hw - WALL
    for s in (-1, 1):
        o = s * hw
        for a, b in piers:
            R.side(a, b, o, SILL, HEAD, s, hull)
            R.side(max(a, xi0), min(b, xi1), s * iv, SILL, HEAD, -s, lining)
        for a, b in windows:
            R.up(a, b, s * iv, o, SILL, hull)
            R.down(a, b, s * iv, o, HEAD, hull)
            R.end(a, s * iv, o, SILL, HEAD, 1, hull)
            R.end(b, s * iv, o, SILL, HEAD, -1, hull)
        for a, b in skirts:
            R.side(a, b, s * (hw + 0.005), 0.1, 0.15, s, line)
            R.side(max(a, xi0), min(b, xi1), s * iv, 0.0, SILL, -s, lining)
        R.side(xi0, xi1, s * iv, HEAD, CEIL, -s, lining)
        # Doors: a leaf set back in the wall with two lit panes, a lit threshold, a lamp over it.
        for d in doors:
            a, b = d - hd, d + hd
            R.down(a, b, s * (hw - 0.12), o, HEAD, hull)
            R.end(a, s * (hw - 0.12), o, 0.02, HEAD, 1, hull)
            R.end(b, s * (hw - 0.12), o, 0.02, HEAD, -1, hull)
            R.side(a, b, s * (hw - 0.12), 0.02, HEAD, s, leaf)
            for p in (-0.3, 0.3):
                R.side(d + p - 0.2, d + p + 0.2, s * (hw - 0.11), 1.05, 1.95, s, lining)
            R.side(d - 0.012, d + 0.012, s * (hw - 0.108), 0.02, HEAD, s, rubber)
            R.up(a, b, s * (hw - 0.12), o, 0.02, tube)
            R.side(d - 0.15, d + 0.15, s * (hw + 0.006), HEAD + 0.07, HEAD + 0.13, s, door_lamp)
        # Bench seats along the walls, between the doors and in the end bays.
        for a, b in ((d0 + hd + 0.25, d1 - hd - 0.25), (xi0 + 0.3, d0 - hd - 0.25), (d1 + hd + 0.25, xi1 - 0.3)):
            R.box(a, b, s * (iv - 0.48), s * iv, 0.4, 0.47, fabric, skip=("bottom", "v+" if s > 0 else "v-"))
            R.side(a, b, s * (iv - 0.06), 0.47, 1.0, -s, fabric)
        R.down(xi0 + 0.6, xi1 - 0.6, s * 0.34, s * 0.48, CEIL - 0.015, tube)
    R.up(xi0, xi1, -iv, iv, 0.0, carpet)
    R.down(xi0, xi1, -iv, iv, CEIL, ceiling)
    # Inner end walls (cab or gangway) and, at gangway ends, the bellows.
    for e in (-1, 1):
        x = x1 - ENDW if e > 0 else x0 + ENDW
        R.end(x, -iv, iv, 0.0, CEIL, -e, lining)
        if not (end and e > 0):
            R.end(x - e * 0.005, -0.4, 0.4, 0.05, 1.95, -e, rubber)
    outline = lower + upper
    caps = [(-1, x0)] + ([] if end else [(1, x1)])
    for e, x in caps:
        pts = [(x, y, z) for y, z in (outline if e > 0 else reversed(outline))]
        mb.quad(pts, hull[0], None, hull[1])
        xb = x + e * gap / 2
        R.box(min(x, xb), max(x, xb), -hw + 0.25, hw - 0.25, 0.1, 2.3, rubber, skip=("u-" if e > 0 else "u+",))

    # Hangers: a fairing on the roof, a plate up into the girder's slot, two raked links.
    for hx in (-0.3 * L, 0.3 * L):
        R.box(hx - 1.1, hx + 1.1, -0.55, 0.55, H - 0.04, H + 0.2, strut_s, skip=("bottom",))
        R.box(hx - 0.18, hx + 0.18, -0.09, 0.09, H + 0.2, hanger_top, strut_s, skip=("bottom",))
        for e in (-1, 1):
            R.strut((hx + e * 0.95, 0.0, H + 0.2), (hx + e * 0.16, 0.0, hanger_top - 0.3), 0.14, 0.1, strut_s)

    # Passengers: silhouettes against the lit interior, some standing in the aisle, some seated.
    standing, seated = 1 + rng.randrange(4), 2 + rng.randrange(4)
    for p in range(standing + seated):
        sit = p >= standing
        tall = 1.55 + rng.random() * 0.3
        cloth = clothes[rng.randrange(len(clothes))]
        px = xi0 + 1.2 + rng.random() * (xi1 - xi0 - 2.4)
        pv = (1 if rng.random() < 0.5 else -1) * (iv - 0.3) if sit else (rng.random() - 0.5) * 0.9
        top = tall * 0.72 if sit else tall
        R.box(px - 0.21, px + 0.21, pv - 0.15, pv + 0.15, 0.45 if sit else 0.02, top - 0.25, cloth, skip=("bottom",))
        R.box(px - 0.1, px + 0.1, pv - 0.11, pv + 0.11, top - 0.25, top, rubber, skip=("bottom",))

    if end:
        # Nose: the section narrowing and dropping on a curve, glazed round the shoulders.
        def bend(t):
            return ((t * t) / 0.7 if t < 0.35 else t - 0.175) / 0.825

        stations = []
        for kk in range(SLICES + 1):
            t = kk / SLICES
            top, bot, wf = H - 1.85 * bend(t), -0.3 + 0.3 * bend(t), 1 - 0.3 * t * t
            stations.append((x1 + t * NOSE, [(y * wf, bot + (z + 0.3) / (H + 0.3) * (top - bot)) for y, z in outline]))

        def pick(i, k):
            # A dark glazed mask over the whole upper nose (beltline up), white below it.
            t = (k + 0.5) / SLICES
            if i in (1, 2, 3, 4, 5):
                return under
            if 7 <= i <= 15:
                return glass if t > ctx.p("mask_from", 0.1) else hull
            return hull

        loft_x(mb, stations, pick)
        xt, tip = stations[-1]
        mb.quad([(xt, y, z) for y, z in tip], hull[0], None, hull[1])
        bot, top = tip[3][1], tip[11][1]
        tw = tip[6][0]
        xf = xt + 0.006
        for s in (-1, 1):
            R.end(xf, s * 0.3, s * (tw - 0.28), bot + 0.28, bot + 0.42, 1, head_lamp)
            R.end(xf, s * (tw - 0.22), s * (tw - 0.08), bot + 0.28, bot + 0.42, 1, tail_lamp)
        R.end(xf, -tw + 0.15, tw - 0.15, bot + 0.16, bot + 0.2, 1, line)
        R.end(xf, -0.45, 0.45, top - 0.24, top - 0.1, 1, door_lamp)          # destination display
    mb.finish()
    length = L + (NOSE if end else gap / 2) + gap / 2
    ctx.meta.update(length=L, width=W, height=hanger_top, nose=NOSE if end else 0, footprint=[length, W],
                    shader="facade", family="train")
