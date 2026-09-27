"""Road vehicle: body, cabin with dark glazing, head and tail lights. Front faces -Y (+Z at
runtime), so the traffic system can orient it along its lane. Facade-shaded (metal, trim,
fixtures), so moving cars join the buildings' batched draw."""
from lib.mesh import MeshBuilder
from lib.surface import fixture, plan_uv, surf


def generate(ctx):
    L, W = ctx.p("length", 4.4), ctx.p("width", 1.8)
    body_h, roof_h = ctx.p("body_height", 0.8), ctx.p("roof_height", 1.45)
    mb = MeshBuilder(ctx.name)
    bm, bs = surf(ctx, "metal", 0.0, ctx.p("tint", 0.5))
    gm, gs = surf(ctx, "metal", 0.0, 0.1)
    # Body and cabin (the cabin sits back from the bonnet; vans and taxis via params).
    mb.box(-W / 2, W / 2, -L / 2, L / 2, 0.2, body_h, bm, None, (), bs, plan_uv)
    c0, c1 = ctx.p("cabin", [-0.9, 1.3])
    mb.box(-W / 2 + 0.1, W / 2 - 0.1, c0, c1, body_h, roof_h, gm, None, ("bottom",), gs, plan_uv)
    hm, hs = fixture(ctx, "white")
    tm, ts = fixture(ctx, "red")
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.3)
        mb.box(x - 0.18, x + 0.18, -L / 2 - 0.02, -L / 2, 0.55, 0.7, hm, None, ("back",), hs, plan_uv)
        mb.box(x - 0.2, x + 0.2, L / 2, L / 2 + 0.02, 0.58, 0.7, tm, None, ("front",), ts, plan_uv)
    if ctx.p("roof_sign", False):
        # Taxi sign on the roof.
        sm, ss = fixture(ctx, "sodium")
        mb.box(-0.3, 0.3, -0.1, 0.1, roof_h, roof_h + 0.18, sm, None, ("bottom",), ss, plan_uv)
    mb.finish()
    ctx.meta.update(footprint=[W, L], height=roof_h, shader="facade", family="vehicle")
