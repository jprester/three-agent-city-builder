"""Glass commercial block (Tokyo station-front offices and stores, see
ref-tokyo-glass-corner-night.jpg, ref-tokyo-banded-towers-day.jpg,
ref-tokyo-sign-buildings-day.jpg): shops at street level, a glass skin above on the
`glass` surface (curtain cells, most floors lit in office white, unlit panes reflect the
city). Skins vary by def: pale vertical fins, horizontal spandrel bands, or plain glass.
The street corner can be rounded. Optional set-back top floors, a lattice crown frame or a
rooftop billboard slot.

The plan is a convex polygon walked counter-clockwise from the front-left corner; walls
are built per edge with u running continuously around it, so curtain cells stay whole
across the rounded corner. Width and depth are bays of two curtain cells."""
import math

from lib.building import cell, roof_clutter, walls
from lib.mesh import MeshBuilder
from lib.surface import plan_uv, surf


def _plan(W, D, r, segs):
    """Footprint polygon (counter-clockwise from above), front-right corner rounded by r."""
    pts = [(-W / 2, -D / 2)]
    if r > 0:
        cx, cy = W / 2 - r, -D / 2 + r
        for k in range(segs + 1):
            a = -math.pi / 2 + k * (math.pi / 2) / segs
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    else:
        pts.append((W / 2, -D / 2))
    pts += [(W / 2, D / 2), (-W / 2, D / 2)]
    return pts


def _edges(pts):
    """(length, transform, u offset) per edge. The transform maps facade-local (x along the
    edge from its middle, y' into the building, z) to building space, like lib.transforms."""
    out, u = [], 0.0
    for k in range(len(pts)):
        (x0, y0), (x1, y1) = pts[k], pts[(k + 1) % len(pts)]
        L = math.hypot(x1 - x0, y1 - y0)
        tx, ty = (x1 - x0) / L, (y1 - y0) / L
        nx, ny = ty, -tx   # outward normal of a counter-clockwise polygon
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2

        def xf(x, y, z, tx=tx, ty=ty, nx=nx, ny=ny, mx=mx, my=my):
            return (mx + tx * x - nx * y, my + ty * x - ny * y, z)
        out.append((L, xf, u))
        u += L
    return out


def _uv(L, u0, vbase):
    """lib.surface.facade_uv with the edge's offset along the perimeter."""
    def uvf(pts, n):
        ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
        if ay >= ax and ay >= az:
            return [(u0 + x + L / 2, z - vbase) for x, y, z in pts]
        if ax >= az:
            return [(-y, z - vbase) for x, y, z in pts]
        return [(u0 + x + L / 2, -y) for x, y, z in pts]
    return uvf


def _shell(mb, ctx, pts, z0, z1, vbase, kind, fill, tint):
    for L, xf, u0 in _edges(pts):
        m, s = surf(ctx, kind, fill, tint)
        mb.quad([(-L / 2, 0, z0), (L / 2, 0, z0), (L / 2, 0, z1), (-L / 2, 0, z1)], m, xf, s, _uv(L, u0, vbase))


def _roof(mb, ctx, pts, z, tint, parapet):
    m, s = surf(ctx, "roof", 0.0, tint)
    mb.quad([(x, y, z) for x, y in pts], m, None, s, plan_uv)
    if parapet <= 0:
        return
    tm, ts = surf(ctx, "trim", 0.0, tint)
    for L, xf, u0 in _edges(pts):
        mb.box(-L / 2, L / 2, 0.0, 0.25, z, z + parapet, tm, xf, ("bottom",), ts, _uv(L, u0, z))


def generate(ctx):
    rng = ctx.rng
    gw, gh = cell(ctx, "curtain")
    _, ph = cell(ctx, "podium")
    bay = 2 * gw
    W, D = ctx.p("width_bays", 8) * bay, ctx.p("depth_bays", 6) * bay
    floors = ctx.p("floors", 14)
    tint = ctx.p("tint", 0.5)
    lod = ctx.p("lod", 0)
    mb = MeshBuilder(ctx.name)
    pts = _plan(W, D, ctx.p("corner_radius", 0.0), ctx.p("corner_segments", 4))

    # Street level: shops (or a glass lobby) under a thin canopy.
    if ctx.p("lobby", False):
        _shell(mb, ctx, pts, 0.0, ph, 0.0, "glass", "grid", tint)
    elif ctx.p("corner_radius", 0.0) > 0:
        _shell(mb, ctx, pts, 0.0, ph, 0.0, "podium", 0.8, tint)   # shops follow the curve
    else:
        walls(mb, ctx, W, D, 0.0, ph, 0.0, [("podium", 1.0, tint), ("podium", 0.6, tint),
                                             ("trim", 0.0, tint), ("podium", 0.6, tint)])
    tm, ts = surf(ctx, "trim", 0.0, tint)
    cd = ctx.p("canopy_depth", 1.2)
    if cd > 0:
        # Along the straight front only, so it never overhangs the rounded corner.
        fw, xf, u0 = _edges(pts)[0]
        sm, ss = surf(ctx, "soffit", 0.0, 0.0)
        mb.box(-fw / 2, fw / 2, -cd, 0.0, ph - 0.35, ph - 0.1, tm, xf, ("back",), ts, _uv(fw, u0, 0.0),
               faces={"bottom": (sm, ss)})

    # Glass body, with an optional set-back top of `top_floors` floors.
    top_floors = ctx.p("top_floors", 0)
    main_top = ph + (floors - top_floors) * gh
    top = ph + floors * gh
    _shell(mb, ctx, pts, ph, main_top, ph, "glass", "grid", tint)
    edges = _edges(pts)

    # Skin: pale fins (every `fin_every` cells, off at lod) or spandrel bands (every floor).
    fin_every = ctx.p("fin_every", 0)
    fin_depth = ctx.p("fin_depth", 0.45)
    if fin_every and not lod:
        for L, xf, u0 in edges:
            uvf = _uv(L, u0, ph)
            n = int(round(L / gw))
            if n < 2:
                continue   # facets of the rounded corner stay clear glass
            for k in range(0, n + 1, fin_every):
                u = -L / 2 + k * L / n
                mb.box(u - 0.14, u + 0.14, -fin_depth, 0.0, ph, main_top, tm, xf, ("back", "bottom"), ts, uvf)
    band = ctx.p("band_height", 0.0)
    if band > 0:
        for L, xf, u0 in edges:
            uvf = _uv(L, u0, ph)
            for f in range(1, floors - top_floors + 1):
                z = ph + f * gh
                mb.box(-L / 2, L / 2, -0.12, 0.0, z - band, z, tm, xf, ("back",), ts, uvf)

    if top_floors:
        _roof(mb, ctx, pts, main_top, tint, 1.0)
        inset = ctx.p("top_inset", bay)
        tw, td = W - 2 * inset, D - inset
        walls(mb, ctx, tw, td, main_top, top, ph, [("glass", "grid", tint)] * 4, 0.0, inset / 2)
        rw, rd, rcy = tw, td, inset / 2
        _roof(mb, ctx, [(x, y) for x, y in [(-tw / 2, rcy - td / 2), (tw / 2, rcy - td / 2), (tw / 2, rcy + td / 2), (-tw / 2, rcy + td / 2)]], top, tint, 1.0)
    else:
        _roof(mb, ctx, pts, top, tint, 1.0)
        rw, rd, rcy = W - 2 * ctx.p("corner_radius", 0.0), D, 0.0

    # Crown: an open lattice frame standing on the roof edge (posts, top and middle rails).
    roof_top = top + 1.0
    crown = ctx.p("crown_height", 0.0)
    if crown > 0:
        mm, ms = surf(ctx, "metal", 0.0, 0.7)
        cpts = pts if not top_floors else [(-rw / 2, rcy - rd / 2), (rw / 2, rcy - rd / 2), (rw / 2, rcy + rd / 2), (-rw / 2, rcy + rd / 2)]
        for L, xf, u0 in _edges(cpts):
            uvf = _uv(L, u0, top)
            for zr in (top + crown * 0.5, top + crown - 0.25):
                mb.box(-L / 2, L / 2, 0.05, 0.3, zr, zr + 0.25, tm, xf, (), ts, uvf)
            if lod:
                continue
            n = max(1, int(L // 1.5))
            for k in range(n + 1):
                u = -L / 2 + k * L / n
                mb.box(u - 0.06, u + 0.06, 0.1, 0.25, top, top + crown, mm, xf, ("bottom",), ms, uvf)
        roof_top = top + crown

    if ctx.p("billboard", False):
        # Rooftop billboard slot facing the street; the runtime builds the board (see midrise).
        bwid, bhei = min(rw - 2, ctx.p("billboard_width", 14.0)), ctx.p("billboard_height", 6.0)
        ctx.meta["billboard"] = {"width": bwid, "height": bhei, "z": top + 1.5, "y": rcy - rd / 2 + 1.0, "legs": 2.0}
        roof_top = max(roof_top, top + 1.5 + bhei)
    roof_top = max(roof_top, roof_clutter(mb, ctx, rw - 2, rd - 2, top, tint, ctx.p("clutter", 0.5), 0.0, rcy, rail=0.0))

    mb.finish()
    ctx.meta.update(canopy=cd, depth=fin_depth if fin_every else 0.3, footprint=[W, D], height=top + 1.0,
                    top=roof_top, family="commercial", scalable=False, shader="facade")
    _ = rng
