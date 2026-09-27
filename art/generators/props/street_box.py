"""Small street furniture, one kind per def (param "kind"):
  cabinet  utility cabinet with a status LED
  bin      litter bin (octagonal)
  vent     ventilation stack for an underground service, louvred top
  bollard  short post with a reflective band"""
from lib.building import prism
from lib.mesh import MeshBuilder
from lib.surface import fixture, plan_uv, surf


def generate(ctx):
    kind = ctx.p("kind", "cabinet")
    mm, ms = surf(ctx, "metal", 0.0, ctx.p("tint", 0.5))
    tm, ts = surf(ctx, "trim", 0.0, ctx.p("tint", 0.5))
    mb = MeshBuilder(ctx.name)
    if kind == "cabinet":
        w, d, h = 0.9, 0.45, 1.3
        mb.box(-w / 2, w / 2, -d / 2, d / 2, 0.0, h, tm, None, ("bottom",), ts, plan_uv)
        mb.box(-w / 2 - 0.03, w / 2 + 0.03, -d / 2 - 0.03, d / 2 + 0.03, h, h + 0.05, mm, None, (), ms, plan_uv)
        fm, fs = fixture(ctx, ctx.p("led", "cyan"))
        mb.box(w / 2 - 0.12, w / 2 - 0.08, -d / 2 - 0.01, -d / 2, h - 0.2, h - 0.16, fm, None, ("back",), fs, plan_uv)
        fp, top = [w, d], h + 0.05
    elif kind == "bin":
        prism(mb, mm, ms, 0.0, 0.0, 0.0, 0.85, 0.25, 8)
        fp, top = [0.5, 0.5], 0.85
    elif kind == "vent":
        w, h = 0.8, 2.4
        mb.box(-w / 2, w / 2, -w / 2, w / 2, 0.0, h, tm, None, ("bottom",), ts, plan_uv)
        for k in range(4):
            z = h - 0.6 + k * 0.15
            mb.box(-w / 2 - 0.05, w / 2 + 0.05, -w / 2 - 0.05, w / 2 + 0.05, z, z + 0.05, mm, None, (), ms, plan_uv)
        mb.box(-w / 2 - 0.1, w / 2 + 0.1, -w / 2 - 0.1, w / 2 + 0.1, h, h + 0.08, mm, None, (), ms, plan_uv)
        fp, top = [w + 0.2, w + 0.2], h + 0.08
    else:  # bollard
        prism(mb, mm, ms, 0.0, 0.0, 0.0, 0.9, 0.09, 6)
        fm, fs = fixture(ctx, "white", strip=True)
        prism(mb, fm, fs, 0.0, 0.0, 0.7, 0.78, 0.095, 6, top=False)
        fp, top = [0.2, 0.2], 0.9
    mb.finish()
    ctx.meta.update(footprint=fp, height=top, shader="facade", family="prop")
