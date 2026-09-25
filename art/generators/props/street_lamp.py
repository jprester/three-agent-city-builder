"""Street lamp: pole, arm reaching out over the road, sodium head. Facade-shaded (metal and
fixture surfaces), so every lamp in the city joins the buildings' single batched draw.
The arm points to -Y in Blender (+Z at runtime); the layout rotates it over the road."""
from lib.mesh import MeshBuilder
from lib.surface import plan_uv, surf


def generate(ctx):
    h = ctx.p("height", 8.0)
    reach = ctx.p("reach", 2.2)
    mm, ms = surf(ctx, "metal", 0.0, 0.4)
    fm, fs = surf(ctx, "fixture", 0.0, 0.0)
    mb = MeshBuilder(ctx.name)
    r = ctx.p("pole_radius", 0.09)
    mb.box(-r, r, -r, r, 0.0, h, mm, None, ("bottom",), ms, plan_uv)
    mb.box(-0.06, 0.06, -reach, 0.0, h - 0.12, h, mm, None, (), ms, plan_uv)
    # Head: dark housing with the lit lens on its underside.
    y0 = -reach - 0.35
    mb.box(-0.22, 0.22, y0, y0 + 0.75, h - 0.28, h - 0.05, mm, None, (), ms, plan_uv,
           faces={"bottom": (fm, fs)})
    mb.finish()
    ctx.meta.update(height=h, shader="facade", family="lamp")
