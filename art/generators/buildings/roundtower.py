"""Round landmark tower: a rounded-square shaft on a rectangular shop podium, getting rounder
and slimmer at each setback until the top tier is a cylinder; a glass lantern crown and a spire.

Every tier's plan is a rounded rectangle whose curved corners are polygons of FACETS one
curtain-wall bay wide (`facet_bays` x the curtain cell): a corner of n facets has the radius
whose chord is exactly a facet, so the glass is flat panels meeting on mullion lines, as real
curved curtain walls are, and every tier's perimeter is whole bays. The facade u runs around
the perimeter without a break (one module per tier band; the closing seam is at the back,
on a bay line).

The facade is a baked tower style pinned by index (`facade`, lib.surface.atlas_pin; default
28 = baked landmark_pearl, which only this tower wears) rather than one of the city's pool.

Tiers (param "tiers"): [height share, straight facets across x, straight facets across y,
facets per quarter-circle corner]. Landmark: fixed height, reserved landmark placement, no
crown lettering (see buildings/tower)."""
import math

from lib.building import cell, flat_roof, mast, walls
from lib.mesh import MeshBuilder
from lib.surface import atlas_pin, fixture, plan_uv, surf


def corner_radius(facet, n):
    """Radius of a quarter circle of n facets, each a chord `facet` long."""
    return facet / (2.0 * math.sin(math.pi / (4 * n)))


def rounded_plan(facet, sx, sy, n):
    """Counter-clockwise (seen from above) vertices of a rounded rectangle: straight sides of
    sx and sy facets, corners of n facets. Starts at the back middle (+y), so the facade's
    closing seam is there. Returns (points, (width, depth))."""
    r = corner_radius(facet, n)
    a, b = sx * facet / 2, sy * facet / 2
    pts = []
    # Corner centres and start angles, CCW from the back-left corner.
    for (cx, cy, a0) in ((-a, b, 90), (-a, -b, 180), (a, -b, 270), (a, b, 0)):
        for k in range(n + 1):
            t = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    # Back middle first; drop repeated points where a straight side has no length.
    if sx > 0:
        pts.insert(0, (0.0, b + r))
    else:
        i = min(range(len(pts)), key=lambda k: abs(pts[k][0]) + abs(pts[k][1] - (b + r)))
        pts = pts[i:] + pts[:i]
    out = []
    for p in pts:
        if not out or math.dist(p, out[-1]) > 1e-6:
            out.append(p)
    if math.dist(out[0], out[-1]) < 1e-6:
        out.pop()
    return out, (2 * (a + r), 2 * (b + r))


def offset_plan(pts, d):
    """The convex plan pushed out by d (in by -d), along each vertex's bisector."""
    n = len(pts)
    out = []
    for i in range(n):
        (x0, y0), (x1, y1), (x2, y2) = pts[i - 1], pts[i], pts[(i + 1) % n]
        e0 = (x1 - x0, y1 - y0)
        e1 = (x2 - x1, y2 - y1)
        l0, l1 = math.hypot(*e0) or 1.0, math.hypot(*e1) or 1.0
        # Outward normals of a CCW polygon: (dy, -dx).
        n0 = (e0[1] / l0, -e0[0] / l0)
        n1 = (e1[1] / l1, -e1[0] / l1)
        bx, by = n0[0] + n1[0], n0[1] + n1[1]
        bl = math.hypot(bx, by)
        k = d / max(0.2, (bx * n0[0] + by * n0[1]) / bl) / bl
        out.append((x1 + bx * k, y1 + by * k))
    return out


def ring(mb, ctx, pts, z0, z1, kind, fill, tint, vbase=None, module=False, smooth=False):
    """Vertical faces round the plan between z0 and z1, u = metres along the perimeter from
    the first vertex, v = metres above vbase (default z0). module: the whole ring is one
    facade band (window and atlas faces); smooth: interpolated normals round the curve."""
    m, s = surf(ctx, kind, fill, tint)
    vb = z0 if vbase is None else vbase
    n = len(pts)
    per = sum(math.dist(pts[i], pts[(i + 1) % n]) for i in range(n))
    u = 0.0
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        u1 = u + math.dist(pts[i], pts[(i + 1) % n])
        uvs = [(u, z0 - vb), (u1, z0 - vb), (u1, z1 - vb), (u, z1 - vb)]
        f = mb.quad([(x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1)], m, None, s,
                    lambda p, nrm, uvs=uvs: uvs, module=(per, z1 - vb) if module else None)
        # Curved glass shades smooth: flat panels a bay wide each mirror one direction, and the
        # one that caught the bright part of the sky lit up as a single glinting bay.
        f.smooth = smooth
        u = u1
    return per


def disc(mb, ctx, pts, z, tint, both=False, thick=0.45):
    """Roof over the plan (a convex n-gon), optionally a closed slab seen from below too."""
    m, s = surf(ctx, "roof", 0.0, tint)
    if both:
        # 5 cm inside the walls it sits on: flush, its sides would z-fight with them.
        pts = offset_plan(pts, -0.05)
        mb.quad([(x, y, z - thick) for x, y in reversed(pts)], m, None, s, plan_uv)
        ring(mb, ctx, pts, z - thick, z, "roof", 0.0, tint)
    mb.quad([(x, y, z) for x, y in pts], m, None, s, plan_uv)


def _check_wrap(ctx, pts, facet):
    """A ring's perimeter must be whole texture repeats (`wrap_bays`, the pinned style's bays per
    repeat): the texture then runs on across the closing seam, which no one can find."""
    n = len(pts)
    bays = round(sum(math.dist(pts[i], pts[(i + 1) % n]) for i in range(n)) / facet * ctx.p("facet_bays", 1))
    wrap = ctx.p("wrap_bays", 12)
    if bays % wrap:
        raise ValueError(f"{ctx.name}: a ring of {bays} bays is not whole repeats of {wrap}; change its facet counts")


def generate(ctx):
    cw, ch = cell(ctx, "curtain")
    _, ph = cell(ctx, "podium")
    facet = ctx.p("facet_bays", 1) * cw
    tint = ctx.p("tint", 0.4)
    height = ctx.p("height", 400.0)
    margin = ctx.p("podium_margin", 3.0)
    pin = atlas_pin(ctx.p("facade", 28))
    light = ctx.p("crown_color", "white")
    tiers = ctx.p("tiers", [[0.42, 12, 8, 9], [0.27, 8, 4, 10], [0.19, 4, 0, 11], [0.12, 0, 0, 10]])
    mb = MeshBuilder(ctx.name)

    # Podium: a rectangular shop base a few metres wider than the tower, so the street front
    # (and the layout's shop signs on it) is a straight wall.
    plans = [rounded_plan(facet, sx, sy, n) for _, sx, sy, n in tiers]
    W0, D0 = plans[0][1]
    W, D = round(W0 + 2 * margin, 3), round(D0 + 2 * margin, 3)
    walls(mb, ctx, W, D, 0.0, ph, 0.0, [("podium", 1.0, tint), ("podium", 0.7, tint), ("podium", 0.5, tint), ("podium", 0.7, tint)])
    fascia = ctx.p("fascia", 1.0)
    walls(mb, ctx, W, D, ph, ph + fascia, ph, [("trim", 0.0, tint)] * 4)
    base = ph + fascia
    flat_roof(mb, ctx, W, D, base, tint, parapet=0.9)

    glow = ctx.facade["fixture_colors"][light]
    rm, rs = surf(ctx, "roof", 0.0, tint)
    z = base
    shaft = height - base
    tier_meta = []
    band = ctx.p("band", 1.2)
    for ti, ((frac, *_), (pts, (w, d))) in enumerate(zip(tiers, plans)):
        if ti > 0:
            # The ledge left by the tier below: a lip standing out 30 cm (its top is the ledge
            # roof), a lit ring tucked under it, then the dark mechanical band this tier stands
            # on (behind the lip from the street).
            lower = plans[ti - 1][0]
            lip = offset_plan(lower, 0.3)
            ring(mb, ctx, lip, z - 0.45, z + 0.5, "trim", 0.0, tint)
            mb.quad([(x, y, z + 0.5) for x, y in lip], rm, None, rs, plan_uv)
            if ctx.p("ledge_lights", True):
                ring(mb, ctx, offset_plan(lower, 0.16), z - 0.75, z - 0.45, "fixture", glow, 1.0)
            ring(mb, ctx, pts, z, z + band, "metal", 0.0, tint)
            z += band
        h = max(ch, round(frac * shaft / ch) * ch)
        _check_wrap(ctx, pts, facet)
        ring(mb, ctx, pts, z, z + h, "atlas", pin, tint, module=True, smooth=True)
        tier_meta.append([round(z, 3), round(z + h, 3), round((W - w) / 2, 3)])
        z += h

    top = _crown(mb, ctx, plans[-1][0], z, tint, pin, facet, light)
    mb.finish()
    ctx.meta.update(footprint=[W, D], height=top, family="tower", scalable=False, shader="facade", tiers=tier_meta,
                    base=base, podium=ph, screen=False, landmark=True, crownSigns=False)


def _crown(mb, ctx, pts, z, tint, pin, facet, light):
    """Collar, a glass lantern with a lit band and a cap, and a spire. (Radial crown blades were
    tried and removed: their thin lit edges flickered as the camera approached.)"""
    m, s = surf(ctx, "metal", 0.0, tint)
    R = max(math.hypot(x, y) for x, y in pts)
    disc(mb, ctx, pts, z, tint, both=True)
    collar = 2.4
    tm, ts = surf(ctx, "trim", 0.0, tint)
    ring(mb, ctx, offset_plan(pts, 0.1), z - 0.6, z + collar, "trim", 0.0, tint)
    mb.quad([(x, y, z + collar) for x, y in offset_plan(pts, 0.1)], tm, None, ts, plan_uv)
    z += collar
    # Lantern: glass on a smaller ring of whole facets, a lit band, a metal cap.
    ln = ctx.p("lantern_facets", 7)
    lpts, _ = rounded_plan(facet, 0, 0, ln)
    lh = ctx.p("lantern_height", 15.2)
    _check_wrap(ctx, lpts, facet)
    ring(mb, ctx, lpts, z, z + lh, "atlas", pin, tint, module=True, smooth=True)
    ring(mb, ctx, lpts, z + lh, z + lh + 2.0, "fixture", ctx.facade["fixture_colors"][light], 1.0)
    cap = [(x * 0.82, y * 0.82) for x, y in lpts]
    ring(mb, ctx, cap, z + lh + 2.0, z + lh + 4.4, "metal", 0.0, tint)
    roof = z + lh + 4.4
    disc(mb, ctx, cap, roof, tint, both=True)
    ctx.meta["roof"] = round(roof, 3)
    # Spire: a tapering mast from the lantern cap, a red light on top.
    spire = ctx.p("spire", 60.0)
    sm, ss = surf(ctx, "metal", 0.0, tint)
    for k in range(8):
        a0, a1 = 2 * math.pi * k / 8, 2 * math.pi * (k + 1) / 8
        r0, r1 = 1.3, 0.25
        mb.quad([(r0 * math.cos(a0), r0 * math.sin(a0), roof), (r0 * math.cos(a1), r0 * math.sin(a1), roof),
                 (r1 * math.cos(a1), r1 * math.sin(a1), roof + spire), (r1 * math.cos(a0), r1 * math.sin(a0), roof + spire)],
                sm, None, ss, plan_uv)
    mast(mb, ctx, 0.0, 0.0, roof + spire, 4.0, red=True)
    # Red obstruction lights on the collar, at the four diagonals.
    rm, rs = fixture(ctx, "red")
    for k in range(4):
        th = math.pi / 4 + k * math.pi / 2
        x, y = (R - 0.6) * math.cos(th), (R - 0.6) * math.sin(th)
        mb.box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, z, z + 0.4, rm, None, ("bottom",), rs, plan_uv)
    return roof + spire + 4.3
