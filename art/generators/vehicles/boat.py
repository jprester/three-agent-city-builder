"""Harbour boats, bow at -Y (+Z at runtime), waterline at z = 0 (the layout sets the water level).

The hull is lofted through stations from bow to stern: a fine bow widening to full beam by
`entry` of the length, a sheer that rises toward the bow, a hard chine above a V bottom that
ends `draft` below the waterline. Two superstructures by `kind`:
  ferry  a harbour ferry: a long lit saloon, an upper deck with a smaller lit cabin, a
         wheelhouse and a mast, railings round the upper deck;
  work   a work or fishing boat: a wheelhouse forward of midships, a mast with a boom, deck
         crates and tyre fenders along the sides.
Lit cabin windows are the lit interior surface (metal fill 0.1) between painted mullions;
navigation lights are vehicle-lamp fixtures (steady, not blinking): white masthead and stern,
red port, cyan starboard (the palette has no green). One facade draw like every vehicle."""
from math import sqrt

from lib.building import prism
from lib.mesh import _normal, MeshBuilder
from lib.surface import fixture, plan_uv, surf
from vehicles.car import CAR_PAINTS


def _paint(ctx, name):
    return surf(ctx, "metal", 0.3, (CAR_PAINTS.index(name) + 0.5) / 12)


def _lit(ctx, kind, glow):
    """Lit interior surface (metal fill 0.1): kind 0 white panel, 1 fabric, 2 carpet, 3 wood."""
    return surf(ctx, "metal", 0.1, (kind + glow) / 4)


def _face(mb, pts, ms, out):
    """A quad or triangle wound so its normal points along `out` (a rough outward direction)."""
    n = _normal(pts)
    if n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0:
        pts = pts[::-1]
    mb.quad(pts, ms[0], None, ms[1], plan_uv)


def _hull(ctx, mb, paint, deck, strake, L, B, free, draft, entry, rise):
    """Lofted hull; returns sheer(y) -> deck height and half(y) -> half beam at model y."""
    n = ctx.p("stations", 9)
    ss = [L * (k / n) ** 1.4 for k in range(n + 1)]       # denser stations toward the bow

    def half(s):
        u = min(1.0, s / (entry * L))
        tail = 1.0 - 0.08 * max(0.0, (s / L - 0.8) / 0.2)  # slight tumble home at the stern
        return max(0.06, B / 2 * sqrt(1.0 - (1.0 - u) ** 2) * tail)

    def sheer(s):
        return free + rise * (1.0 - s / L) ** 2

    def section(s):
        h, z = half(s), sheer(s)
        return [(0.0, s, -draft * min(1.0, 0.3 + s / (entry * L))), (h * 0.8, s, 0.15), (h, s, z)]

    y0 = -L / 2
    secs = [[(x, y0 + y, z) for x, y, z in section(s)] for s in ss]
    for a, b in zip(secs, secs[1:]):
        for sx in (1, -1):
            m = lambda p: (sx * p[0], p[1], p[2])
            for i in range(2):
                pts = [m(a[i]), m(b[i]), m(b[i + 1]), m(a[i + 1])]
                _face(mb, pts, paint, (sx, 0.0, -0.3 if i == 0 else 0.0))
        # Pale rubbing strake just under the sheer: the hull's edge reads against dark water.
        for sx in (1, -1):
            sa, sb = a[2], b[2]
            _face(mb, [(sx * (sa[0] + 0.03), sa[1], sa[2] - 0.22), (sx * (sb[0] + 0.03), sb[1], sb[2] - 0.22),
                       (sx * (sb[0] + 0.03), sb[1], sb[2] - 0.04), (sx * (sa[0] + 0.03), sa[1], sa[2] - 0.04)],
                  strake, (sx, 0.0, 0.0))
        # Deck between the sheer lines.
        _face(mb, [(-a[2][0], a[2][1], a[2][2]), (a[2][0], a[2][1], a[2][2]),
                   (b[2][0], b[2][1], b[2][2]), (-b[2][0], b[2][1], b[2][2])], deck, (0.0, 0.0, 1.0))
    # Transom: one flat face per side, keel to sheer.
    t = secs[-1]
    for sx in (1, -1):
        _face(mb, [(0.0, t[0][1], t[0][2]), (sx * t[1][0], t[1][1], t[1][2]),
                   (sx * t[2][0], t[2][1], t[2][2]), (0.0, t[2][1], t[2][2])], paint, (0.0, 1.0, 0.0))
    return (lambda y: sheer(y - y0)), (lambda y: half(y - y0))


def _cabin(mb, x0, x1, y0, y1, z0, h, wall, roof, lit, mullion, win=(0.35, 0.85), pitch=1.3):
    """A deckhouse: painted walls with a band of lit windows on every side, a roof overhang."""
    mb.box(x0, x1, y0, y1, z0, z0 + h, wall[0], None, ("bottom", "top"), wall[1], plan_uv)
    mb.box(x0 - 0.12, x1 + 0.12, y0 - 0.12, y1 + 0.12, z0 + h, z0 + h + 0.12, roof[0], None, (), roof[1], plan_uv)
    wz0, wz1 = z0 + h * win[0], z0 + h * win[1]
    e = 0.03
    # Long sides: lit bands with mullions at `pitch`.
    for sx in (-1, 1):
        x = x1 if sx > 0 else x0
        xa, xb = (x, x + e) if sx > 0 else (x - e, x)
        mb.box(xa, xb, y0 + 0.4, y1 - 0.4, wz0, wz1, lit[0], None, ("left" if sx > 0 else "right",), lit[1], plan_uv)
        k = int((y1 - y0 - 0.8) / pitch)
        for j in range(1, k):
            y = y0 + 0.4 + j * (y1 - y0 - 0.8) / k
            mb.box(xa - 0.005 * sx, xb + 0.005 * sx, y - 0.06, y + 0.06, wz0, wz1, mullion[0], None, (), mullion[1], plan_uv)
    # Ends: one lit band each.
    for y, face in ((y0, "back"), (y1, "front")):
        ya, yb = (y - e, y) if face == "back" else (y, y + e)
        mb.box(x0 + 0.4, x1 - 0.4, ya, yb, wz0, wz1, lit[0], None, (face,), lit[1], plan_uv)


def _rail(mb, x0, x1, y0, y1, z, steel, h=1.0):
    """Railing round a rectangle: posts every ~1.5 m and a top rail."""
    t = 0.03
    for (ax, ay), (bx, by) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        mb.box(min(ax, bx) - t, max(ax, bx) + t, min(ay, by) - t, max(ay, by) + t, z + h - 0.05, z + h, steel[0], None, (), steel[1], plan_uv)
        seg = max(abs(bx - ax), abs(by - ay))
        k = max(1, int(seg / 1.5))
        for j in range(k):
            px, py = ax + (bx - ax) * j / k, ay + (by - ay) * j / k
            mb.box(px - t, px + t, py - t, py + t, z, z + h, steel[0], None, ("bottom",), steel[1], plan_uv)


def generate(ctx):
    kind = ctx.p("kind", "work")
    L, B = ctx.p("length", 14.0), ctx.p("beam", 4.6)
    free, draft = ctx.p("freeboard", 1.1), ctx.p("draft", 1.0)
    mb = MeshBuilder(ctx.name)
    hull = _paint(ctx, ctx.p("hull_paint", "car_navy"))
    upper = _paint(ctx, ctx.p("cabin_paint", "car_white"))
    deck = surf(ctx, "metal", 0.0, ctx.p("deck_tint", 0.45))
    steel = surf(ctx, "metal", 0.0, 0.6)
    rubber = surf(ctx, "metal", 0.8, 0.0)
    lit = _lit(ctx, ctx.p("cabin_finish", 0), ctx.p("cabin_glow", 0.8))
    strake = _paint(ctx, ctx.p("strake_paint", "car_white"))
    sheer, half = _hull(ctx, mb, hull, deck, strake, L, B, free, draft, ctx.p("entry", 0.38), ctx.p("bow_rise", 0.7))
    # Boot top: a pale band at the waterline so the hull separates from the dark water.
    boot = _paint(ctx, ctx.p("boot_paint", "car_white"))
    for sx in (-1, 1):
        for k in range(8):
            ya, yb = -L / 2 + L * (0.3 + 0.7 * k / 8), -L / 2 + L * (0.3 + 0.7 * (k + 1) / 8)
            xa, xb = half(ya) * 0.8 + 0.02, half(yb) * 0.8 + 0.02
            _face(mb, [(sx * xa, ya, 0.05), (sx * xb, yb, 0.05), (sx * xb, yb, 0.2), (sx * xa, ya, 0.2)], boot, (sx, 0.0, 0.0))

    head = fixture(ctx, "white", lamp=True)
    red = fixture(ctx, "red", lamp=True)
    stbd = fixture(ctx, "cyan", lamp=True)
    z_deck = sheer(0.0)
    if kind == "ferry":
        # Main saloon over most of the length, upper cabin and wheelhouse on top.
        hw = half(0.0) - 0.5
        y0, y1 = -L / 2 + L * 0.28, L / 2 - 1.2
        h1 = ctx.p("saloon_height", 2.5)
        _cabin(mb, -hw, hw, y0, y1, z_deck, h1, upper, upper, lit, upper)
        z2 = z_deck + h1 + 0.12
        _cabin(mb, -hw * 0.7, hw * 0.7, y0 + 1.5, y0 + L * 0.3, z2, 2.2, upper, upper, lit, upper, pitch=1.1)
        _rail(mb, -hw, hw, y0 + 0.2, y1 - 0.2, z2, steel)
        top = z2 + 2.2 + 0.12
        mast_y = y0 + 2.5
        # Funnel aft on the upper deck.
        mb.box(-0.5, 0.5, y1 - 3.2, y1 - 2.0, z2, z2 + 2.4, hull[0], None, ("bottom",), hull[1], plan_uv)
        # Sidelights on the wheelhouse wings.
        mb.box(-hw * 0.7 - 0.25, -hw * 0.7 - 0.05, y0 + 1.6, y0 + 1.9, z2 + 1.6, z2 + 1.8, red[0], None, (), red[1], plan_uv)
        mb.box(hw * 0.7 + 0.05, hw * 0.7 + 0.25, y0 + 1.6, y0 + 1.9, z2 + 1.6, z2 + 1.8, stbd[0], None, (), stbd[1], plan_uv)
    else:
        # Wheelhouse just forward of midships, a short mast with a boom over the aft deck.
        hw = min(half(0.0) - 0.4, 1.5)
        y0 = -L / 2 + L * 0.3
        y1 = y0 + ctx.p("house_length", 3.4)
        h1 = 2.1
        _cabin(mb, -hw, hw, y0, y1, z_deck, h1, upper, upper, lit, upper, win=(0.5, 0.9), pitch=0.9)
        top = z_deck + h1 + 0.12
        mast_y = y1 + 0.3
        mb.box(-0.06, 0.06, mast_y, mast_y + 0.12, top - 0.6, top + 1.0, steel[0], None, (), steel[1], plan_uv)
        mb.box(-0.05, 0.05, mast_y, L / 2 - 1.5, top - 0.1, top, steel[0], None, (), steel[1], plan_uv)   # boom
        # Deck cargo: a few crates and a winch drum, picked by seed.
        for k in range(ctx.rng.randint(2, 4)):
            cx = ctx.rng.uniform(-hw, hw) * 0.8
            cy = ctx.rng.uniform(y1 + 1.0, L / 2 - 1.5)
            w = ctx.rng.uniform(0.6, 1.1)
            crate = _paint(ctx, ctx.rng.choice(["car_orange", "paint_blue", "car_grey"]))
            mb.box(cx - w / 2, cx + w / 2, cy - w / 2, cy + w / 2, sheer(cy), sheer(cy) + w * 0.7, crate[0], None, ("bottom",), crate[1], plan_uv)
        # Tyre fenders hung along the sides.
        for sx in (-1, 1):
            for k in range(4):
                fy = -L / 2 + L * (0.35 + 0.15 * k)
                fx = sx * (half(fy) + 0.18)
                prism(mb, rubber[0], rubber[1], fx, fy, 0.3, 0.75, 0.22, 6)
        mb.box(-hw - 0.2, -hw, y0 + 0.3, y0 + 0.55, z_deck + 1.5, z_deck + 1.7, red[0], None, (), red[1], plan_uv)
        mb.box(hw, hw + 0.2, y0 + 0.3, y0 + 0.55, z_deck + 1.5, z_deck + 1.7, stbd[0], None, (), stbd[1], plan_uv)
    # Mast with the white masthead light; a white stern light.
    mh = ctx.p("mast_height", 3.0)
    mb.box(-0.07, 0.07, mast_y - 0.07, mast_y + 0.07, top, top + mh, steel[0], None, ("bottom",), steel[1], plan_uv)
    mb.box(-0.14, 0.14, mast_y - 0.14, mast_y + 0.14, top + mh, top + mh + 0.25, head[0], None, ("bottom",), head[1], plan_uv)
    zs = sheer(L / 2) + 0.3
    mb.box(-0.15, 0.15, L / 2 - 0.05, L / 2 + 0.08, zs, zs + 0.2, head[0], None, ("front",), head[1], plan_uv)
    mb.finish()
    ctx.meta.update(footprint=[B + 0.5, L], height=top + mh + 0.25, shader="facade", family="vehicle")
