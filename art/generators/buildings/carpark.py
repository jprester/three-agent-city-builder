"""Multi-storey car park: concrete spandrel bands around the building with open decks
between them. Through each opening you see a dark recessed interior and, on the slot's
ceiling, fluorescent tubes: a strongly horizontal light pattern unlike any other block.
Ground floor: shops on the front. Roof deck with sodium lamp posts."""
from lib.building import cell, flat_roof, side_frame, walls
from lib.mesh import MeshBuilder
from lib.surface import facade_uv, fixture, plan_uv, surf


def generate(ctx):
    rw, _ = cell(ctx, "residential")
    _, ph = cell(ctx, "podium")
    W, D = ctx.p("width_bays", 8) * rw, ctx.p("depth_bays", 6) * rw
    decks = ctx.p("decks", 5)
    dh = ctx.p("deck_height", 3.0)
    band = ctx.p("band", 1.1)
    inset = ctx.p("inset", 1.4)
    tint = ctx.p("tint", 0.5)
    top = ph + decks * dh
    mb = MeshBuilder(ctx.name)

    walls(mb, ctx, W, D, 0.0, ph, 0.0, [("podium", 0.8, tint), ("trim", 0.0, tint), ("trim", 0.0, tint), ("trim", 0.0, tint)])
    tm, ts = surf(ctx, "trim", 0.0, tint)
    mm, ms = surf(ctx, "metal", 0.0, 0.1)
    sm, ss = surf(ctx, "soffit", 0.0, 0.0)
    for side in range(4):
        fw, xf = side_frame(side, W, D)
        uvf = facade_uv(fw, ph)
        for k in range(decks):
            z = ph + k * dh
            # Spandrel band.
            mb.quad([(-fw / 2, 0, z), (fw / 2, 0, z), (fw / 2, 0, z + band), (-fw / 2, 0, z + band)], tm, xf, ts, uvf)
            z1 = z + dh
            # Recessed dark interior, deck floor, lit slot ceiling.
            mb.quad([(-fw / 2, inset, z + band), (fw / 2, inset, z + band), (fw / 2, inset, z1), (-fw / 2, inset, z1)], mm, xf, ms, uvf)
            mb.quad([(-fw / 2, 0, z + band), (fw / 2, 0, z + band), (fw / 2, inset, z + band), (-fw / 2, inset, z + band)], tm, xf, ts, uvf)
            mb.quad([(-fw / 2, inset, z1), (fw / 2, inset, z1), (fw / 2, 0, z1), (-fw / 2, 0, z1)], sm, xf, ss, uvf)
    flat_roof(mb, ctx, W, D, top, tint, parapet=1.2)
    # Roof deck lamp posts.
    fm, fs = fixture(ctx, "sodium")
    for x in (-W / 4, W / 4):
        for y in (-D / 4, D / 4):
            mb.box(x - 0.08, x + 0.08, y - 0.08, y + 0.08, top, top + 5.0, mm, None, ("bottom",), ms, plan_uv)
            mb.box(x - 0.3, x + 0.3, y - 0.2, y + 0.2, top + 5.0, top + 5.25, fm, None, (), fs, plan_uv)
    mb.finish()
    ctx.meta.update(footprint=[W, D], height=top + 1.2, top=top + 5.25, family="carpark", scalable=False, shader="facade")
