"""Mid-rise mixed-use block: a storefront podium (optionally with mall floors above it) and a
body set back from the street, with office or residential cells. With `podium_floors: 0`
it becomes an industrial block: roller doors at street level, sparse office windows.

Width and depth are whole residential cells (3.2 m), which are also whole office cells."""
from lib.building import cell, flat_roof, roof_clutter, side_frame, walls
from lib.mesh import MeshBuilder
from lib.surface import facade_uv, surf


def generate(ctx):
    rng = ctx.rng
    rw, _ = cell(ctx, "residential")
    _, oh = cell(ctx, "office")
    _, ph = cell(ctx, "podium")
    W = ctx.p("width_bays", 6) * rw
    D = ctx.p("depth_bays", 5) * rw
    tint = ctx.p("tint", 0.5)
    body = ctx.p("body", "office")
    _, bh = cell(ctx, body)
    podium_floors = ctx.p("podium_floors", 2)
    floors = ctx.p("floors", 8)
    mb = MeshBuilder(ctx.name)

    if podium_floors > 0:
        walls(mb, ctx, W, D, 0.0, ph, 0.0, [
            ("podium", 1.0, tint), ("podium", 0.6, tint), ("trim", 0.0, tint), ("podium", 0.6, tint)])
        ptop = ph + (podium_floors - 1) * oh
        if podium_floors > 1:
            mall = ctx.p("mall_fill", 0.5)
            walls(mb, ctx, W, D, ph, ptop, ph, [("office", mall, tint), ("office", mall * 0.6, tint), ("trim", 0.0, tint), ("office", mall * 0.6, tint)])
        cd = ctx.p("canopy_depth", 1.8)
        if cd > 0:
            fw, xf = side_frame(0, W, D)
            tm, ts = surf(ctx, "trim", 0.0, tint)
            sm, ss = surf(ctx, "soffit", 0.0, 0.0)
            mb.box(-fw / 2, fw / 2, -cd, 0.0, ph - 0.45, ph - 0.1, tm, xf, ("back",), ts, facade_uv(fw, 0.0), faces={"bottom": (sm, ss)})
        setback = ctx.p("setback_bays", 1) * rw
    else:
        ptop = 0.0
        setback = 0.0

    # Body, set back from the front and the sides so the podium roof shows.
    bw, bd = W - 2 * setback, D - setback
    cy = setback / 2
    top = ptop + floors * bh
    fill = ctx.p("fill", 1.0 if podium_floors > 0 else 0.35)
    if body == "office" and podium_floors > 0:
        # Office bodies take a photographic facade like the towers.
        walls(mb, ctx, bw, bd, ptop, top, ptop, [("atlas", 1.0, tint)] * 4, 0.0, cy)
    else:
        walls(mb, ctx, bw, bd, ptop, top, ptop, [
            (body, fill, tint), (body, fill * ctx.p("side_fill", 0.5), tint),
            (body, fill * 0.8, tint), (body, fill * ctx.p("side_fill", 0.5), tint)], 0.0, cy)

    if podium_floors == 0:
        # Industrial ground floor: roller doors and a lamp over each.
        fw, xf = side_frame(0, bw, bd, 0.0, cy)
        mm, ms = surf(ctx, "metal", 0.0, 0.2)
        fm, fs = surf(ctx, "fixture", 0.0, 0.0)
        uvf = facade_uv(fw, ptop)
        n = max(1, int(fw // 8))
        for k in range(n):
            u = -fw / 2 + (k + 0.5) * fw / n
            mb.quad([(u - 2.2, -0.05, 0.0), (u + 2.2, -0.05, 0.0), (u + 2.2, -0.05, 4.2), (u - 2.2, -0.05, 4.2)], mm, xf, ms, uvf)
            mb.box(u - 0.25, u + 0.25, -0.5, 0.0, 4.6, 4.8, fm, xf, ("back",), fs, uvf)
    else:
        flat_roof(mb, ctx, W, D, ptop, tint, parapet=0.9)

    flat_roof(mb, ctx, bw, bd, top, tint, 0.0, cy)
    roof_top = roof_clutter(mb, ctx, bw, bd, top, tint, ctx.p("clutter", 1.0), 0.0, cy)
    if ctx.p("billboard", False):
        # Rooftop billboard frame facing the street (signs are placed on it at runtime).
        mm, ms = surf(ctx, "metal", 0.0, 0.1)
        bwid, bhei = min(bw - 2, 12.0), 5.0
        y0 = cy - bd / 2 + 1.0
        for x in (-bwid / 2, bwid / 2):
            mb.box(x - 0.15, x + 0.15, y0, y0 + 0.3, top, top + 2.0 + bhei, mm, None, ("bottom",), ms, None)
        mb.box(-bwid / 2, bwid / 2, y0 + 0.3, y0 + 0.5, top + 2.0, top + 2.0 + bhei, mm, None, ("bottom",), ms, None)
        roof_top = max(roof_top, top + 2.0 + bhei)
        ctx.meta["billboard"] = {"width": bwid, "height": bhei, "z": top + 2.0, "y": y0}

    mb.finish()
    ctx.meta.update(footprint=[W, D], height=top + 1.0, top=roof_top, family="midrise", scalable=False, shader="facade")
    _ = rng
