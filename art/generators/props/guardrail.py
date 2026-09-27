"""Pedestrian guardrail along the curb (the painted steel railings lining Hong Kong
streets): posts, top and bottom rails and a slatted infill panel, one segment of
`length` meters. Runs along X; the layout places it parallel to the curb."""
from lib.mesh import MeshBuilder
from lib.surface import plan_uv, surf


def generate(ctx):
    L = ctx.p("length", 6.0)
    h = ctx.p("height", 1.05)
    post = ctx.p("post_spacing", 2.0)
    mm, ms = surf(ctx, "metal", 0.0, ctx.p("tint", 0.7))
    mb = MeshBuilder(ctx.name)
    t = 0.04
    n = max(1, int(round(L / post)))
    for k in range(n + 1):
        x = -L / 2 + k * L / n
        mb.box(x - t, x + t, -t, t, 0.0, h, mm, None, ("bottom",), ms, plan_uv)
    for z in (h - 0.06, 0.25):
        mb.box(-L / 2, L / 2, -t, t, z, z + 0.06, mm, None, (), ms, plan_uv)
    # Vertical slats between the rails (only the ones that read; ~every 0.3 m).
    slats = int(L / ctx.p("slat_spacing", 0.3))
    for k in range(1, slats):
        x = -L / 2 + k * L / slats
        mb.box(x - 0.012, x + 0.012, -0.015, 0.015, 0.31, h - 0.06, mm, None, ("bottom", "top"), ms, plan_uv)
    mb.finish()
    ctx.meta.update(footprint=[L, 0.12], height=h, shader="facade", family="prop")
