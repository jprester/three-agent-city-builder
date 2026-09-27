"""Walk-up tenement (tong lau): 5-8 floors on a narrow lot, shops behind a canopy at street
level, and a full-width veranda on every upper floor. Owners have enclosed some verandas
with windows over the decades, so each floor is randomly open (slab + railing) or
enclosed (a glazed box whose front carries shaded windows). Painted, cluttered roof.

Width and depth are whole residential cells so the enclosed fronts' windows align."""
from lib.building import cell, flat_roof, roof_clutter, side_frame, walls
from lib.mesh import MeshBuilder
from lib.surface import facade_uv, surf


def generate(ctx):
    rng = ctx.rng
    cw, ch = cell(ctx, "residential")
    _, ph = cell(ctx, "podium")
    bays = ctx.p("bays", 3)
    W, D = bays * cw, ctx.p("depth_bays", 4) * cw
    floors = ctx.p("floors", 6)
    tint = ctx.p("tint", 0.5)
    top = ph + floors * ch
    mb = MeshBuilder(ctx.name)

    walls(mb, ctx, W, D, ph, top, ph, [
        ("residential", "grid", tint), ("residential", ctx.p("side_pattern", "blank"), tint),
        ("residential", ctx.p("back_pattern", "alternate"), tint), ("residential", ctx.p("side_pattern", "blank"), tint)])
    walls(mb, ctx, W, D, 0.0, ph, 0.0, [("podium", 1.0, tint), ("trim", 0.0, tint), ("trim", 0.0, tint), ("trim", 0.0, tint)])

    fw, xf = side_frame(0, W, D)
    tm, ts = surf(ctx, "trim", 0.0, tint)
    sm, ss = surf(ctx, "soffit", 0.0, 0.0)
    rm, rs = surf(ctx, "residential", "grid", tint, bays)
    mm, ms = surf(ctx, "metal", 0.0, 0.4)
    cd = ctx.p("canopy_depth", 1.8)
    mb.box(-fw / 2, fw / 2, -cd, 0.0, ph - 0.45, ph - 0.1, tm, xf, ("back",), ts, facade_uv(fw, 0.0), faces={"bottom": (sm, ss)})

    uvf = facade_uv(fw, ph)
    vd = ctx.p("veranda_depth", 1.4)
    for f in range(floors):
        z = ph + f * ch
        if rng.random() < ctx.p("enclosed", 0.5):
            # Enclosed veranda: a box whose front face carries windows.
            mb.box(-fw / 2, fw / 2, -vd, 0.0, z, z + ch, tm, xf, ("back",), ts, uvf, faces={"front": (rm, rs)})
        else:
            mb.box(-fw / 2, fw / 2, -vd, 0.0, z, z + 0.18, tm, xf, ("back",), ts, uvf)
            rail = mm if rng.random() < 0.5 else tm
            rails = ms if rail is mm else ts
            mb.box(-fw / 2, fw / 2, -vd, -vd + 0.06, z + 0.18, z + 1.1, rail, xf, ("back", "bottom"), rails, uvf)
            # Laundry poles / clutter hint: a thin bar at head height.
            if rng.random() < 0.4 and not ctx.p("lod", 0):
                mb.box(-fw / 2 + 0.3, fw / 2 - 0.3, -vd - 0.4, -vd - 0.35, z + 2.2, z + 2.26, mm, xf, (), ms, uvf)
    # End posts carrying the verandas.
    for u in (-fw / 2, fw / 2 - 0.3):
        mb.box(u, u + 0.3, -vd, -vd + 0.3, ph, top, tm, xf, ("back", "bottom"), ts, uvf)

    flat_roof(mb, ctx, W, D, top, tint, parapet=1.1)
    roof_top = roof_clutter(mb, ctx, W, D, top, tint, ctx.p("clutter", 1.3))
    if rng.random() < ctx.p("shack_chance", 0.5):
        sw, sd = W * 0.6, D * 0.5
        walls(mb, ctx, sw, sd, top, top + ch, top, [("residential", "stair", tint)] * 4, 0.0, D * 0.2)
        flat_roof(mb, ctx, sw, sd, top + ch, tint, 0.0, D * 0.2, parapet=0.0)
        roof_top = max(roof_top, top + ch)
    mb.finish()
    ctx.meta.update(canopy=cd, depth=vd + 0.45, footprint=[W, D], height=top + 1.1, top=roof_top, family="walkup", scalable=False, shader="facade")
