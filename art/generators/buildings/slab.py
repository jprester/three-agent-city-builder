"""Old residential slab (Mong Kok tenement): storefront podium with a street canopy,
residential floors with balcony stacks, cage windows and AC units on the front,
sparse windows and AC units on the sides, rooftop clutter and an occasional rooftop
shack. Windows are shaded at runtime; geometry only carries what protrudes.

Width and depth are whole residential cells so shaded windows align with the
balconies, cages and AC units placed here. All tunables are def params."""
from lib.building import cell, flat_roof, roof_clutter, side_frame, walls
from lib.mesh import MeshBuilder
from lib.surface import facade_uv, surf


def generate(ctx):
    rng = ctx.rng
    cw, ch = cell(ctx, "residential")
    _, ph = cell(ctx, "podium")
    bays = ctx.p("bays", 6)
    W = bays * cw
    D = ctx.p("depth_bays", 4) * cw
    floors = ctx.p("floors", 16)
    tint = ctx.p("tint", 0.3)
    top = ph + floors * ch

    mb = MeshBuilder(ctx.name)
    side_fill = ctx.p("side_fill", 0.18)
    walls(mb, ctx, W, D, ph, top, ph, [
        ("residential", 1.0, tint), ("residential", side_fill, tint),
        ("residential", ctx.p("back_fill", 0.85), tint), ("residential", side_fill, tint),
    ])
    walls(mb, ctx, W, D, 0.0, ph, 0.0, [
        ("podium", ctx.p("shop_fill", 1.0), tint), ("podium", 0.25, tint),
        ("trim", 0.0, tint), ("podium", 0.25, tint),
    ])

    # Street canopy over the sidewalk: concrete slab, lit soffit.
    fw, xf = side_frame(0, W, D)
    cd = ctx.p("canopy_depth", 2.4)
    if cd > 0:
        tm, ts = surf(ctx, "trim", 0.0, tint)
        sm, ss = surf(ctx, "soffit", 0.0, 0.0)
        mb.box(-fw / 2, fw / 2, -cd, 0.0, ph - 0.45, ph - 0.1, tm, xf, ("back",), ts, facade_uv(fw, 0.0),
               faces={"bottom": (sm, ss)})

    # Front: balcony stacks by column, then cages and AC units on the other cells.
    balcony_cols = {c for c in range(bays) if rng.random() < ctx.p("balcony_ratio", 0.3)}
    tm, ts = surf(ctx, "trim", 0.0, tint)
    cm, cs = surf(ctx, "cage", 0.0, tint)
    am, as_ = surf(ctx, "metal", 0.0, 0.5)
    uvf = facade_uv(fw, ph)
    bd = ctx.p("balcony_depth", 1.1)
    for c in range(bays):
        u0 = -fw / 2 + c * cw
        for f in range(floors):
            z = ph + f * ch
            if c in balcony_cols:
                mb.box(u0 + 0.12, u0 + cw - 0.12, -bd, 0.0, z, z + 0.15, tm, xf, ("back",), ts, uvf)
                mb.box(u0 + 0.12, u0 + cw - 0.12, -bd, -bd + 0.08, z + 0.15, z + 1.1, tm, xf, ("back", "bottom"), ts, uvf)
                continue
            r = rng.random()
            if r < ctx.p("cage_ratio", 0.12):
                mb.box(u0 + 0.55, u0 + cw - 0.55, -0.45, 0.0, z + 0.7, z + 2.5, cm, xf, ("back",), cs, uvf)
            elif r < ctx.p("cage_ratio", 0.12) + ctx.p("ac_ratio", 0.35):
                ax = u0 + cw / 2 + rng.choice((-0.75, 0.75))
                mb.box(ax - 0.4, ax + 0.4, -0.55, 0.0, z + 0.2, z + 0.75, am, xf, ("back",), as_, uvf)

    # Vertical concrete fins between bays catch street light and break up the flat front.
    if ctx.p("fins", False):
        for c in range(1, bays):
            u = -fw / 2 + c * cw
            mb.box(u - 0.12, u + 0.12, -0.35, 0.0, ph, top, tm, xf, ("back", "bottom"), ts, uvf)

    # Sides: AC units scattered on the mostly blank walls.
    for side in (1, 3):
        sw, sxf = side_frame(side, W, D)
        suvf = facade_uv(sw, ph)
        for f in range(floors):
            for k in range(int(sw // cw)):
                if rng.random() < ctx.p("side_ac_ratio", 0.08):
                    ax = -sw / 2 + (k + 0.5) * cw
                    z = ph + f * ch
                    mb.box(ax - 0.4, ax + 0.4, -0.55, 0.0, z + 0.2, z + 0.75, am, sxf, ("back",), as_, suvf)

    flat_roof(mb, ctx, W, D, top, tint)
    roof_top = roof_clutter(mb, ctx, W, D, top, tint, ctx.p("clutter", 1.0))

    # Rooftop shack: one set-back residential floor on part of the roof.
    if rng.random() < ctx.p("shack_chance", 0.4):
        sw, sd = cw * max(1, bays // 2 - 1), cw * 2
        sx = rng.choice((-1, 1)) * (W - sw) / 2 * 0.6
        sy = (D - sd) / 2 - 0.4
        walls(mb, ctx, sw, sd, top, top + ch, top, [("residential", 0.7, tint)] * 4, sx, sy)
        flat_roof(mb, ctx, sw, sd, top + ch, tint, sx, sy, parapet=0.0)
        roof_top = max(roof_top, top + ch)

    mb.finish()
    ctx.meta.update(footprint=[W, D], height=top + 1.0, top=roof_top, family="slab", scalable=False, shader="facade")
