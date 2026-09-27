"""Street kiosk (newsstand / snack stall): a small box whose front (-Y, faces the road) is
a lit counter opening, a canopy with a lit soffit, stacked crates beside it and a sign
board on the roof. Facade-shaded, so kiosks join the buildings' batched draw."""
from lib.mesh import MeshBuilder
from lib.surface import facade_uv, plan_uv, surf
from lib.transforms import facade_xf


def generate(ctx):
    rng = ctx.rng
    W, D, H = ctx.p("width", 2.4), ctx.p("depth", 1.5), ctx.p("height", 2.6)
    tint = ctx.p("tint", 0.4)
    mb = MeshBuilder(ctx.name)
    bm, bs = surf(ctx, "trim", 0.0, tint)
    pm, ps = surf(ctx, "podium", 1.0, tint)
    sm, ss = surf(ctx, "soffit", 0.0, 0.0)
    mm, ms = surf(ctx, "metal", 0.0, 0.3)
    # Body: shop-front shading on the street side, plain panels elsewhere.
    mb.box(-W / 2, W / 2, -D / 2, D / 2, 0.0, H, bm, None, ("bottom",), bs, plan_uv, faces={"front": (pm, ps)})
    # Canopy over the counter.
    xf = facade_xf(0, W, D)
    cd = ctx.p("canopy", 0.9)
    mb.box(-W / 2 - 0.1, W / 2 + 0.1, -cd, 0.0, H - 0.35, H - 0.2, mm, xf, ("back",), ms, facade_uv(W, 0.0),
           faces={"bottom": (sm, ss)})
    # Sign board on the roof and a few crates at one side.
    mb.box(-W / 2 + 0.1, W / 2 - 0.1, -D / 2 + 0.2, -D / 2 + 0.3, H, H + 0.6, bm, None, ("bottom",), bs, plan_uv)
    side = rng.choice((-1, 1))
    for k in range(rng.randint(1, 3)):
        cx = side * (W / 2 + 0.35)
        mb.box(cx - 0.3, cx + 0.3, -D / 2 + 0.1, -D / 2 + 0.6, k * 0.35, k * 0.35 + 0.33, mm, None, ("bottom",), ms, plan_uv)
    mb.finish()
    ctx.meta.update(footprint=[W + 1.3, D], height=H + 0.6, shader="facade", family="prop")
