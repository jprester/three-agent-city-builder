"""Suspended monorail (Chiba style): the static pieces, one per def via the `piece` param.

Line pieces repeat along the route: `pier` (T pier in the median), `girder` (one 30 m span of
both box girders; the layout stretches it to each pier gap), `median` (1 m of raised median,
stretched). Station pieces are built in the station's frame, origin at its centre (u along the
line, v across, +v the deck side): `platform` and `screens` (one side each, `side` = +1 / -1),
`portal`, `roof` and `deck` (one bay, repeated), `access_n` (deck up to the north platform),
`access_s` (sidewalk up to the south platform), `deck_stairs` (sidewalk up to the deck).
Station pieces declare where they touch the ground in meta.ground ([u0, u1, v0, v1] rects);
the layout (art/layouts/lib/monorail.mjs) keeps those on sidewalks.

Everything is facade-shaded (metal subtypes for paint, glass and rubber, fixtures for light),
so the whole structure shares the buildings' shader program. Dimensions are params; the
layout's MONORAIL_DEFAULTS carries the same numbers (tests/unit/monorail.test.ts)."""
from math import ceil

from lib.mesh import MeshBuilder
from lib.solids import Route, prism_x
from lib.surface import fixture, surf
from vehicles.car import CAR_PAINTS


def _paint(ctx, name):
    return surf(ctx, "metal", 0.3, (CAR_PAINTS.index(name) + 0.5) / 12)


def _structural(ctx, name):
    """Painted structural steel (metal fill 0.4): the paint over plated, bolted, streaked steel."""
    return surf(ctx, "metal", 0.4, (CAR_PAINTS.index(name) + 0.5) / 12)


def _lit(ctx, kind, glow):
    """Lit interior surface (metal fill 0.1): kind 0 white panel, 1 fabric, 2 carpet, 3 wood."""
    return surf(ctx, "metal", 0.1, (kind + glow) / 4)


class Kit:
    def __init__(self, ctx):
        self.silver = _paint(ctx, "car_silver")
        self.grey = _paint(ctx, "car_grey")
        self.white = _paint(ctx, "car_white")
        self.navy = _paint(ctx, "car_navy")
        self.red = _paint(ctx, "car_red")
        self.yellow = _paint(ctx, "car_yellow")
        self.glass = surf(ctx, "metal", 0.5, 0.0)
        self.rubber = surf(ctx, "metal", 0.8, 0.0)
        self.steel = surf(ctx, "metal", 0.0, 0.5)
        self.concrete = surf(ctx, "roof", 0.0, ctx.p("concrete_tint", 0.6))
        # Station floors: roof fill 1 is the tiled floor (src/materials/facade.ts).
        self.floor = surf(ctx, "roof", 1.0, ctx.p("floor_tint", 0.7))
        # Light paint so the plates, ribs and joints still read under the night fill.
        self.structure = _structural(ctx, ctx.p("structure_paint", "car_white"))
        self.structure_dark = _structural(ctx, ctx.p("structure_paint_dark", "car_silver"))
        self.soffit = surf(ctx, "soffit", 0.0, 0.0)
        self.tube = fixture(ctx, "white", strip=True)
        self.line = fixture(ctx, "cyan", strip=True)
        self.lamp = fixture(ctx, "cyan")
        self.beacon = fixture(ctx, "red")
        self.panel = _lit(ctx, 0, 0.75)
        self.frosted = _lit(ctx, 0, ctx.p("frosted_glow", 0.05))
        self.wood = _lit(ctx, 3, 0.12)


def _solid(a, b, holes):
    """Parts of [a, b] left after removing `holes` (each (lo, hi))."""
    out, at = [], a
    for lo, hi in sorted(holes):
        if lo > at:
            out.append((at, min(lo, b)))
        at = max(at, hi)
    if b > at:
        out.append((at, b))
    return [(p, q) for p, q in out if q - p > 0.05]


def _dims(ctx):
    d = dict(
        beam_y=ctx.p("beam_y", 11.7), beam_h=ctx.p("beam_h", 1.7), track_v=ctx.p("track_v", 2.6),
        girder_w=ctx.p("girder_w", 1.5), floor_y=ctx.p("floor_y", 8.05), roof_y=ctx.p("roof_y", 14.6),
        bays=ctx.p("bays", 4), bay=ctx.p("bay", 17.0), leg_v=ctx.p("leg_v", 13.5),
        platform=ctx.p("platform", [4.05, 7.8]), deck_y=ctx.p("deck_y", 5.6), deck_v=ctx.p("deck_v", [13.3, 17.3]),
        car_length=ctx.p("car_length", 14.5), car_gap=ctx.p("car_gap", 0.5), car_count=ctx.p("car_count", 3),
        doors=ctx.p("doors", [-3.6, 3.6]), riser=ctx.p("riser", 0.18), tread=ctx.p("tread", 0.3),
        landing=ctx.p("landing", 1.6), max_rise=ctx.p("max_rise", 4.0),
    )
    d["length"] = d["bays"] * d["bay"]
    d["roof_top"] = d["roof_y"] + 0.24
    d["door_xs"] = [(c - (d["car_count"] - 1) / 2) * (d["car_length"] + d["car_gap"]) + x
                    for c in range(d["car_count"]) for x in d["doors"]]
    return d


def _stair_run(d, rise):
    flights = ceil(rise / d["max_rise"] - 1e-6)
    steps = round(rise / flights / d["riser"])
    return flights * steps * d["tread"] + (flights - 1) * d["landing"]


def _open_stair(R, k, d, u0, v, y0, y1, direction, width):
    """Open stair from (u0, v) at y0 rising toward `direction` (+1 / -1 along u) to y1: separate
    treads on two stringers, a handrail on posts each side, and a landing on two columns
    wherever a flight would rise more than max_rise. Returns the u where it arrives."""
    flights = ceil((y1 - y0) / d["max_rise"] - 1e-6)
    rise = (y1 - y0) / flights
    steps = round(rise / d["riser"])
    r, run = rise / steps, steps * d["tread"]
    sides = [v - width / 2 - 0.05, v + width / 2 + 0.05]
    at, y = u0, y0
    for f in range(flights):
        for i in range(steps):
            a = at + direction * i * d["tread"]
            R.box(a, a + direction * (d["tread"] + 0.03), v - width / 2, v + width / 2, y + (i + 1) * r - 0.06, y + (i + 1) * r, k.concrete)
        for sv in sides:
            R.strut((at, sv, y - 0.12), (at + direction * run, sv, y + rise - 0.12), 0.08, 0.3, k.structure_dark)
            R.strut((at, sv, y + 0.95), (at + direction * run, sv, y + rise + 0.95), 0.05, 0.05, k.silver)
            for j in (1, 2, 3):
                pu, py = at + direction * run * j / 4, y + rise * j / 4
                R.box(pu - 0.02, pu + 0.02, sv - 0.02, sv + 0.02, py, py + 0.95, k.silver, skip=("bottom", "top"))
        at += direction * run
        y += rise
        if f < flights - 1:
            b = at + direction * d["landing"]
            R.box(at, b, v - width / 2 - 0.1, v + width / 2 + 0.1, y - 0.2, y, k.concrete)
            for sv in sides:
                R.box(at, b, sv - 0.025, sv + 0.025, y + 0.92, y + 0.97, k.silver)
                cu = b - direction * 0.15
                R.box(cu - 0.07, cu + 0.07, sv - 0.07, sv + 0.07, 0.0, y - 0.2, k.structure_dark, skip=("bottom", "top"))
            at = b
    return at


def _rail(R, k, u0, u1, v, y, glass=True):
    """Balustrade along u at v standing on y: glass panel under a top rail."""
    if glass:
        # Frosted lower panel (lit by the platform), clear glass above it.
        R.box(u0, u1, v - 0.025, v + 0.025, y, y + 0.7, k.frosted, skip=("bottom",))
        R.box(u0, u1, v - 0.02, v + 0.02, y + 0.7, y + 1.12, k.glass)
    R.box(u0, u1, v - 0.035, v + 0.035, y + 1.12, y + 1.18, k.silver)


def pier(ctx, mb, R, k, d):
    beam_top = d["beam_y"] + d["beam_h"]
    tv, gw = d["track_v"], d["girder_w"]
    R.box(-1.2, 1.2, -1.0, 1.0, 0.0, 0.32, k.concrete, skip=("bottom",))                        # footing
    R.box(-0.85, 0.85, -0.75, 0.75, 0.32, 2.8, k.concrete, skip=("bottom",))                    # plinth
    R.box(-0.93, 0.93, -0.83, 0.83, 2.8, 2.92, k.structure)                                        # cap
    for s in (-1, 1):
        R.side(-0.3, 0.3, s * 0.756, 0.6, 1.95, s, k.steel)                                    # access doors
    R.box(-0.66, 0.66, -0.6, 0.6, 2.92, 3.0, k.line, skip=("bottom",))                          # lit collar
    R.column(0.0, 0.0, 0.58, 3.0, beam_top, k.structure, sides=8, caps=(False, False))             # shaft
    # Arm across both girders, its ends tapering underneath.
    reach = tv + gw / 2 + 0.4
    y0, y1 = beam_top, beam_top + 1.0
    prism_x(mb, [(-reach + 0.55, y0), (reach - 0.55, y0), (reach, y0 + 0.5), (reach, y1), (-reach, y1), (-reach, y0 + 0.5)],
            -0.75, 0.75, k.structure)
    for s in (-1, 1):
        gv = s * tv
        # Bearing plates down the girder's flanks under the arm, a beacon on each arm end.
        for f in (-1, 1):
            R.box(-0.6, 0.6, gv + f * (gw / 2 + 0.01), gv + f * (gw / 2 + 0.06), beam_top - 1.0, beam_top, k.structure_dark, skip=("top",))
        R.box(-0.15, 0.15, s * (reach - 0.35) - 0.15, s * (reach - 0.35) + 0.15, y1, y1 + 0.12, k.beacon, skip=("bottom",))
        # Knee brace from the shaft up under the arm, inside the inner girder.
        R.strut((0.0, s * 0.45, beam_top - 1.7), (0.0, s * (tv - gw / 2 - 0.2), beam_top + 0.02), 0.45, 0.24, k.structure)
    mb.finish()
    ctx.meta.update(height=y1 + 0.12, footprint=[2.4, 2 * reach], shader="facade", family="monorail")


def girder(ctx, mb, R, k, d):
    span = ctx.p("span", 30.0)
    h = span / 2 - 0.01                       # 2 cm joint between spans
    y0, y1 = d["beam_y"], d["beam_y"] + d["beam_h"]
    tv, w = d["track_v"], d["girder_w"] / 2
    ribs = ctx.p("rib_every", 7.5)
    for s in (-1, 1):
        gv = s * tv
        # Box girder with chamfered lower edges (profile in Blender y = -v).
        by = -gv
        prism_x(mb, [(by - w + 0.14, y0), (by + w - 0.14, y0), (by + w, y0 + 0.14), (by + w, y1), (by - w, y1), (by - w, y0 + 0.14)],
                -h, h, k.structure)
        R.down(-h, h, gv - 0.17, gv + 0.17, y0 - 0.01, k.rubber)                               # hanger slot
        outer = gv + s * (w - 0.3)
        R.box(-h + 0.1, h - 0.1, outer - 0.04, outer + 0.04, y0 - 0.06, y0 - 0.005, k.line)    # light line
        u = -span / 2 + ribs / 2
        while u < span / 2:
            for f in (-1, 1):
                fv = gv + f * w
                R.box(u - 0.06, u + 0.06, fv, fv + f * 0.045, y0 + 0.16, y1 - 0.06, k.structure_dark, skip=("v-" if f > 0 else "v+",))
            u += ribs
        inner = gv - s * (w - 0.22)
        R.box(-h, h, inner - 0.17, inner + 0.17, y1, y1 + 0.16, k.steel, skip=("bottom",))      # cable tray
        rail = gv + s * (w - 0.06)
        for y in (0.55, 1.05):
            R.box(-h, h, rail - 0.025, rail + 0.025, y1 + y - 0.025, y1 + y + 0.025, k.silver)
        p = -span / 2 + 2.0
        while p < span / 2 - 1.0:
            R.box(p - 0.025, p + 0.025, rail - 0.025, rail + 0.025, y1, y1 + 1.06, k.silver, skip=("bottom", "top"))
            p += 4.0
    mb.finish()
    ctx.meta.update(height=y1 + 1.1, footprint=[span, 2 * (tv + w)], span=span, shader="facade", family="monorail")


def median(ctx, mb, R, k, d):
    w, h = ctx.p("width", 2.4) / 2, ctx.p("height", 0.18)
    prism_x(mb, [(-w, 0.0), (w, 0.0), (w, h - 0.05), (w - 0.05, h), (-w + 0.05, h), (-w, h - 0.05)], -0.5, 0.5,
            lambda i: k.concrete if i in (3, -1) else k.grey)
    mb.finish()
    ctx.meta.update(height=h, footprint=[1.0, 2 * w], shader="facade", family="monorail")


def portal(ctx, mb, R, k, d):
    lv, top = d["leg_v"], d["roof_top"]
    for s in (-1, 1):
        v = s * lv
        R.box(-0.55, 0.55, v - 0.45, v + 0.45, 0.0, 0.15, k.structure_dark, skip=("bottom",))
        R.column(0.0, v, 0.38, 0.15, top, k.structure, sides=8, caps=(False, False))
        # Haunch under the beam.
        R.strut((0.0, v - s * 0.3, top - 1.6), (0.0, v - s * 2.4, top + 0.02), 0.35, 0.3, k.structure)
    R.box(-0.45, 0.45, -lv - 0.4, lv + 0.4, top, top + 0.95, k.structure)
    mb.finish()
    ctx.meta.update(height=top + 0.95, footprint=[1.1, 2 * lv + 0.9], shader="facade", family="monorail",
                    ground=[[-0.55, 0.55, -lv - 0.45, -lv + 0.45], [-0.55, 0.55, lv - 0.45, lv + 0.45]])


def roof(ctx, mb, R, k, d):
    hu, hv, y = d["bay"] / 2, ctx.p("roof_half", 8.6), d["roof_y"]
    R.box(-hu, hu, -hv, hv, y, y + 0.24, k.structure, faces={"bottom": k.soffit, "top": k.concrete})
    for s in (-1, 1):
        # Fascia along each edge with a light line under its lip.
        R.box(-hu, hu, s * hv, s * (hv + 0.1), y - 0.25, y + 0.42, k.structure, skip=("v-" if s > 0 else "v+",))
        R.box(-hu + 0.05, hu - 0.05, s * (hv + 0.02) - 0.03, s * (hv + 0.02) + 0.03, y - 0.31, y - 0.25, k.line, skip=("top",))
    mb.finish()
    ctx.meta.update(height=y + 0.42, footprint=[2 * hu, 2 * hv + 0.2], shader="facade", family="monorail")


def deck(ctx, mb, R, k, d):
    """One bay of the pedestrian deck, slung between two portal legs (notched round them) on
    steel edge beams, lit from underneath."""
    hu, y, (v0, v1), lv = d["bay"] / 2, d["deck_y"], d["deck_v"], d["leg_v"]
    notch = lv + 0.4
    R.box(-hu, hu, notch, v1, y - 0.3, y, k.concrete, faces={"top": k.floor})
    R.box(-hu + 0.5, hu - 0.5, v0, notch, y - 0.3, y, k.concrete, skip=("v+",), faces={"top": k.floor})
    for bv in (notch + 0.05, v1 - 0.25):
        R.box(-hu + 0.45, hu - 0.45, bv - 0.15, bv + 0.15, y - 0.75, y - 0.3, k.structure, skip=("top",))
    for u in (-hu / 2, hu / 2):
        R.box(u - 1.6, u + 1.6, (notch + v1) / 2 - 0.05, (notch + v1) / 2 + 0.05, y - 0.36, y - 0.3, k.tube, skip=("top",))
    mb.finish()
    ctx.meta.update(height=y, footprint=[2 * hu, v1 - v0], shader="facade", family="monorail", ground=[])


def platform(ctx, mb, R, k, d):
    s = ctx.p("side", 1)
    p0, p1 = d["platform"]
    L, y, ry = d["length"] / 2, d["floor_y"], d["roof_y"]
    v = lambda x: s * x
    opening = ctx.p("opening", [6.0, 9.0])
    holes = [(-opening[1], -opening[0]), (opening[0], opening[1])]
    R.box(-L, L, v(p0), v(p1), y - 0.36, y, k.concrete, faces={"top": k.floor})
    R.up(-L + 0.1, L - 0.1, v(p0 + 0.4), v(p0 + 0.62), y + 0.006, k.yellow)                      # tactile strip
    R.box(-L + 0.2, L - 0.2, v(p0 + 0.08) - 0.03, v(p0 + 0.08) + 0.03, y - 0.42, y - 0.36, k.line, skip=("top",))
    for a, b in _solid(-L, L, holes):
        _rail(R, k, a, b, v(p1 - 0.05), y)
    for e in (-1, 1):
        R.box(e * L - 0.025, e * L + 0.025, v(p0 + 0.6), v(p1 - 0.08), y, y + 1.12, k.frosted, skip=("bottom",))
    # Hangers from the roof along the outer edge.
    u = -L + 3.0
    while u <= L - 2.9:
        if not any(a - 0.4 < u < b + 0.4 for a, b in holes):
            R.box(u - 0.06, u + 0.06, v(p1 - 0.12) - 0.06, v(p1 - 0.12) + 0.06, y + 1.18, ry, k.structure, skip=("bottom", "top"))
        u += 6.2
    # Tube lights hung over the platform's middle.
    pm = (p0 + p1) / 2 + 0.4
    u = -L + 4.0
    while u < L - 3.0:
        R.box(u - 1.2, u + 1.2, v(pm) - 0.07, v(pm) + 0.07, y + 2.82, y + 2.9, k.tube)
        R.box(u - 0.015, u + 0.015, v(pm) - 0.015, v(pm) + 0.015, y + 2.9, ry, k.steel, skip=("bottom", "top"))
        u += 6.0
    # Furniture along the back: a vending machine, a bench, alternating; a name board hanging.
    clear = lambda a, b: not any(b > p - 0.4 and a < q + 0.4 for p, q in holes)
    back, face = v(p1 - 0.5), v(p1 - 0.86)
    u, n = -L + 6.0, 0
    while u < L - 6.0:
        if clear(u - 1.4, u + 1.4):
            if n % 2 == 0:
                body = k.navy if (n // 2 + (s > 0)) % 2 else k.red
                R.box(u - 0.5, u + 0.5, back - 0.35, back + 0.35, y, y + 1.84, body, skip=("bottom",),
                      faces={("v-" if s > 0 else "v+"): k.panel})
            else:
                R.box(u - 1.1, u + 1.1, back - 0.25, back + 0.25, y + 0.4, y + 0.48, k.wood)
                for o in (-0.9, 0.9):
                    R.box(u + o - 0.04, u + o + 0.04, back - 0.2, back + 0.2, y, y + 0.4, k.steel, skip=("bottom", "top"))
        u += 8.5
        n += 1
    for bu in (-20.0, 21.0):
        R.box(bu - 0.85, bu + 0.85, v(pm) - 0.03, v(pm) + 0.03, y + 2.3, y + 2.75, k.panel)
        R.box(bu - 0.8, bu + 0.8, v(pm) - 0.035, v(pm) + 0.035, y + 2.33, y + 2.38, k.line)
        for o in (-0.7, 0.7):
            R.box(bu + o - 0.015, bu + o + 0.015, v(pm) - 0.015, v(pm) + 0.015, y + 2.75, ry, k.steel, skip=("bottom", "top"))
    mb.finish()
    ctx.meta.update(height=ry - y, footprint=[2 * L, p1 - p0], opening=opening, shader="facade", family="monorail")


def screens(ctx, mb, R, k, d):
    s = ctx.p("side", 1)
    p0 = d["platform"][0]
    L, y, ry = d["length"] / 2 - 1.0, d["floor_y"], d["roof_y"]
    v = lambda x: s * x
    sv = v(p0 + 0.08)
    gaps = [(x - 0.9, x + 0.9) for x in d["door_xs"]]
    for a, b in _solid(-L, L, gaps):
        panels = ceil((b - a) / 3.6)
        pl = (b - a) / panels
        for j in range(panels):
            u = a + (j + 0.5) * pl
            R.box(u - pl / 2 + 0.03, u + pl / 2 - 0.03, sv - 0.025, sv + 0.025, y, y + 0.12, k.silver, skip=("bottom",))
            R.box(u - pl / 2 + 0.03, u + pl / 2 - 0.03, sv - 0.02, sv + 0.02, y + 0.12, y + 0.75, k.frosted)
            R.box(u - pl / 2 + 0.03, u + pl / 2 - 0.03, sv - 0.015, sv + 0.015, y + 0.75, y + 1.2, k.glass)
            R.box(u - pl / 2 + 0.03, u + pl / 2 - 0.03, sv - 0.035, sv + 0.035, y + 1.2, y + 1.26, k.tube)
        for u in (a, b):
            R.box(u - 0.05, u + 0.05, sv - 0.06, sv + 0.06, y, y + 1.32, k.silver, skip=("bottom",))
    for x in d["door_xs"]:
        R.up(x - 0.8, x + 0.8, v(p0 + 0.02), v(p0 + 0.2), y + 0.008, k.tube)                       # lit threshold
        for o in (-0.75, 0.75):
            R.up(x + o - 0.05, x + o + 0.05, v(p0 + 0.8), v(p0 + 2.4), y + 0.006, k.white)          # queue lines
        R.box(x + 0.86, x + 0.94, sv - 0.07, sv + 0.07, y + 1.32, y + 1.44, k.lamp, skip=("bottom",))
    # Over the track edge: a fascia with a line of tubes under it, lighting the standing train.
    fv = v(p0 + 0.25)
    R.box(-L, L, fv - 0.03, fv + 0.03, y + 2.9, y + 3.2, k.silver)
    u = -L + 1.5
    while u < L - 1.0:
        R.box(u - 1.5, u + 1.5, fv + s * 0.07 - 0.05, fv + s * 0.07 + 0.05, y + 2.84, y + 2.9, k.tube, skip=("top",))
        u += 3.5
    for u in (-L + 4.0, -L / 3, L / 3, L - 4.0):
        R.box(u - 0.03, u + 0.03, fv - 0.03, fv + 0.03, y + 3.2, ry, k.steel, skip=("bottom", "top"))
    mb.finish()
    ctx.meta.update(height=ry - y, footprint=[2 * L, 0.5], door_xs=d["door_xs"], shader="facade", family="monorail")


def access_n(ctx, mb, R, k, d):
    """Deck up to the north platform: per end, a landing off the deck, one flight in the gap
    between deck and platform, a landing onto the platform. Also the deck's street-side rail."""
    p1, (v0, v1), dy, fy = d["platform"][1], d["deck_v"], d["deck_y"], d["floor_y"]
    width = ctx.p("width", 1.4)
    gv = ctx.p("stair_v", 10.5)
    top_u = ctx.p("top_u", 9.0)
    run = _stair_run(d, fy - dy)
    low = (top_u + run, top_u + run + 3.0)
    for e in (-1, 1):
        _open_stair(R, k, d, e * low[0], gv, dy, fy, -e, width)
        # Landing off the deck (hung from it) and onto the platform, with outer rails.
        R.box(e * low[0], e * low[1], gv - width / 2 - 0.2, v0, dy - 0.2, dy, k.concrete, faces={"top": k.floor})
        _rail(R, k, e * low[0], e * low[1], gv - width / 2 - 0.15, dy)
        R.box(e * low[1] - 0.03, e * low[1] + 0.03, gv - width / 2 - 0.2, v0, dy, dy + 1.12, k.frosted, skip=("bottom",))
        R.box(e * (top_u - 3.0), e * top_u, p1, gv + width / 2 + 0.2, fy - 0.2, fy, k.concrete, faces={"top": k.floor})
        _rail(R, k, e * (top_u - 3.0), e * top_u, gv + width / 2 + 0.15, fy)
        # Across the far end, and beside the stair head down to the platform's edge.
        for u, a, b in ((e * (top_u - 3.0), p1 + 0.05, gv + width / 2 + 0.2), (e * top_u, p1 + 0.05, gv - width / 2 - 0.1)):
            R.box(u - 0.025, u + 0.025, a, b, fy, fy + 1.12, k.frosted, skip=("bottom",))
            R.box(u - 0.035, u + 0.035, a, b, fy + 1.12, fy + 1.18, k.silver)
    # Deck rail on the street side: open at the portal legs and where the landings join.
    L = ctx.p("deck_bays", 2) * d["bay"] / 2
    legs = [u for u in (-d["length"] / 2 + i * d["bay"] for i in range(d["bays"] + 1)) if abs(u) <= L + 0.01]
    holes = [(u - 0.6, u + 0.6) for u in legs] + [(-low[1], -low[0]), low]
    for a, b in _solid(-L, L, holes):
        _rail(R, k, a, b, v0 + 0.06, dy)
    mb.finish()
    ctx.meta.update(height=fy + 1.2, footprint=[2 * low[1], v1 - p1], stair_run=run, landing_u=[low[0], low[1]],
                    shader="facade", family="monorail", ground=[])


def access_s(ctx, mb, R, k, d):
    """Sidewalk up to the south platform: per end, an open stair (a landing halfway) beside the
    portal legs, then a railed bridge across the street's edge to the platform."""
    p1, fy, lv = d["platform"][1], d["floor_y"], d["leg_v"]
    width = ctx.p("width", 1.3)
    sv = -(lv + 0.5)
    u0 = ctx.p("bottom_u", 1.2)
    base = ctx.p("base_y", 0.15)
    run = _stair_run(d, fy - base)
    top = u0 + run
    for e in (-1, 1):
        _open_stair(R, k, d, e * u0, sv, base, fy, e, width)
        a, b = e * top, e * (top + 3.0)
        R.box(a, b, sv - width / 2 - 0.1, -p1, fy - 0.2, fy, k.concrete, faces={"top": k.floor})
        _rail(R, k, a, b, sv - width / 2 - 0.05, fy)
        R.box(b - 0.025, b + 0.025, sv - width / 2 - 0.1, -p1 - 0.05, fy, fy + 1.12, k.frosted, skip=("bottom",))
        R.box(b - 0.035, b + 0.035, sv - width / 2 - 0.1, -p1 - 0.05, fy + 1.12, fy + 1.18, k.silver)
        R.box(a - 0.025, a + 0.025, sv + width / 2 + 0.1, -p1 - 0.05, fy, fy + 1.12, k.frosted, skip=("bottom",))
        R.box(a - 0.035, a + 0.035, sv + width / 2 + 0.1, -p1 - 0.05, fy + 1.12, fy + 1.18, k.silver)
    mb.finish()
    g = [sv - width / 2 - 0.12, sv + width / 2 + 0.12]
    ctx.meta.update(height=fy + 1.2, footprint=[2 * (top + 3.0), lv], stair_run=run, opening=[top, top + 3.0],
                    shader="facade", family="monorail", ground=[[u0, top, *g], [-top, -u0, *g]])


def deck_stairs(ctx, mb, R, k, d):
    """Sidewalk up to each end of the deck, along the building side."""
    (v0, v1), dy = d["deck_v"], d["deck_y"]
    L = ctx.p("deck_bays", 2) * d["bay"] / 2
    width = ctx.p("width", 1.3)
    base = ctx.p("base_y", 0.15)
    sv = v1 - 0.1 - width / 2
    run = _stair_run(d, dy - base)
    for e in (-1, 1):
        _open_stair(R, k, d, e * (L + run), sv, base, dy, -e, width)
    mb.finish()
    g = [sv - width / 2 - 0.12, sv + width / 2 + 0.12]
    ctx.meta.update(height=dy + 1.2, footprint=[2 * (L + run), width], stair_run=run,
                    shader="facade", family="monorail", ground=[[L, L + run, *g], [-L - run, -L, *g]])


PIECES = dict(pier=pier, girder=girder, median=median, portal=portal, roof=roof, deck=deck, platform=platform,
              screens=screens, access_n=access_n, access_s=access_s, deck_stairs=deck_stairs)


def generate(ctx):
    piece = ctx.p("piece", "pier")
    mb = MeshBuilder(ctx.name)
    PIECES[piece](ctx, mb, Route(mb), Kit(ctx), _dims(ctx))
