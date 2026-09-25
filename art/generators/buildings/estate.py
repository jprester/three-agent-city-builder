"""Housing estate block: a shopping podium over the whole lot (storefronts, a mall floor, a
podium roof garden deck) carrying two to four slim residential towers of slightly different
heights, windows on every side, AC units, water tanks and aviation lights on top.

Dimensions are whole residential cells."""
from lib.building import aviation_lights, cell, flat_roof, side_frame, walls, water_tank
from lib.mesh import MeshBuilder
from lib.surface import facade_uv, surf


def generate(ctx):
    rng = ctx.rng
    cw, ch = cell(ctx, "residential")
    _, oh = cell(ctx, "office")
    _, ph = cell(ctx, "podium")
    W, D = ctx.p("width_bays", 12) * cw, ctx.p("depth_bays", 9) * cw
    tint = ctx.p("tint", 0.5)
    ptop = ph + oh
    mb = MeshBuilder(ctx.name)
    walls(mb, ctx, W, D, 0.0, ph, 0.0, [("podium", 1.0, tint), ("podium", 0.6, tint), ("trim", 0.0, tint), ("podium", 0.6, tint)])
    walls(mb, ctx, W, D, ph, ptop, ph, [("office", 0.5, tint), ("office", 0.3, tint), ("trim", 0.0, tint), ("office", 0.3, tint)])
    flat_roof(mb, ctx, W, D, ptop, tint, parapet=1.1)

    n = ctx.p("towers", 2)
    tw, td = ctx.p("tower_bays", 5) * cw, ctx.p("tower_depth_bays", 4) * cw
    floors = ctx.p("floors", 28)
    am, as_ = surf(ctx, "metal", 0.0, 0.5)
    top = ptop
    for k in range(n):
        cx = -W / 2 + (k + 0.5) * W / n
        cy = (D - td) / 2 * (0.4 if k % 2 else -0.2)
        f = floors + rng.randint(-3, 3)
        t_top = ptop + f * ch
        walls(mb, ctx, tw, td, ptop, t_top, ptop, [("residential", 1.0, tint), ("residential", 0.8, tint),
                                                    ("residential", 1.0, tint), ("residential", 0.8, tint)], cx, cy)
        # AC units on every face.
        for side in range(4):
            fw, xf = side_frame(side, tw, td, cx, cy)
            uvf = facade_uv(fw, ptop)
            for fl in range(f):
                for c in range(int(fw // cw)):
                    if rng.random() < ctx.p("ac_ratio", 0.12):
                        ax = -fw / 2 + (c + 0.5) * cw + rng.choice((-0.75, 0.75))
                        z = ptop + fl * ch
                        mb.box(ax - 0.4, ax + 0.4, -0.55, 0.0, z + 0.2, z + 0.75, am, xf, ("back",), as_, uvf)
        flat_roof(mb, ctx, tw, td, t_top, tint, cx, cy, parapet=1.2)
        water_tank(mb, ctx, cx - tw * 0.2, cy, t_top, 2.6)
        aviation_lights(mb, ctx, tw, td, t_top + 1.2, cx, cy)
        top = max(top, t_top)
    mb.finish()
    ctx.meta.update(footprint=[W, D], height=top + 1.2, top=top + 4.0, family="estate", scalable=False, shader="facade")
