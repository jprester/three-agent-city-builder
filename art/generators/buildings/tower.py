"""Setback tower: storefront and office base, a glass curtain-wall shaft that steps in at
each tier, a lit crown band and a mast with an aviation light. Scalable: the layout
stretches towers to 150-400 m and the facade shader keeps glass cells at their real size.

Width and depth are whole curtain cells (1.5 m)."""
from lib.building import cell, flat_roof, mast, walls
from lib.mesh import MeshBuilder


def generate(ctx):
    cw, ch = cell(ctx, "curtain")
    _, oh = cell(ctx, "office")
    _, ph = cell(ctx, "podium")
    W = ctx.p("width_cells", 22) * cw
    D = ctx.p("depth_cells", 20) * cw
    tint = ctx.p("tint", 0.6)
    height = ctx.p("height", 180.0)
    mb = MeshBuilder(ctx.name)

    base_top = ph + ctx.p("base_floors", 2) * oh
    walls(mb, ctx, W, D, 0.0, ph, 0.0, [("podium", 1.0, tint), ("podium", 0.7, tint), ("podium", 0.5, tint), ("podium", 0.7, tint)])
    walls(mb, ctx, W, D, ph, base_top, ph, [("office", 0.7, tint)] * 4)

    z = base_top
    w, d = W, D
    shaft = height - base_top - 4.0
    tiers = ctx.p("tiers", [[0.6, 1], [0.28, 3], [0.12, 5]])
    for frac, inset in tiers:
        flat_roof(mb, ctx, w, d, z, tint, parapet=0.6)   # ledge left by the previous tier
        w, d = W - 2 * inset * cw, D - 2 * inset * cw
        h = max(ch, round(frac * shaft / ch) * ch)
        walls(mb, ctx, w, d, z, z + h, z, [("curtain", 1.0, tint)] * 4)
        z += h

    # Crown: lit band, then the roof and a mast.
    walls(mb, ctx, w, d, z, z + 1.2, z, [("fixture", 0.5, 0.0)] * 4)
    walls(mb, ctx, w, d, z + 1.2, z + 4.0, z, [("trim", 0.0, tint)] * 4)
    z += 4.0
    flat_roof(mb, ctx, w, d, z, tint, parapet=0.0)
    mast(mb, ctx, 0.0, 0.0, z, ctx.p("mast", 18.0), red=True)

    mb.finish()
    ctx.meta.update(footprint=[W, D], height=z, family="tower", scalable=True, shader="facade")
