"""Kit: wall panel with vertical ribs, plus build_ledge() reused by buildings."""
from lib.materials import material
from lib.mesh import MeshBuilder


def build_ledge(mb, facade_w, z, mat, xf=None, overhang=0.3, thickness=0.25):
    """Horizontal band across a facade at height z, protruding `overhang`."""
    mb.box(-facade_w / 2 - overhang, facade_w / 2 + overhang, -overhang, 0.0,
           z, z + thickness, mat, xf, skip=("back",))


def generate(ctx):
    w = ctx.p("width", 4.0)
    h = ctx.p("height", 3.2)
    t = ctx.p("thickness", 0.3)
    ribs = ctx.p("ribs", 3)
    concrete = material(ctx, "M_concrete", "concrete", roughness=0.9)
    mb = MeshBuilder(ctx.name)
    mb.box(-w / 2, w / 2, 0.0, t, 0.0, h, concrete)
    rib_w = 0.18
    for i in range(ribs):
        u = -w / 2 + (i + 1) * w / (ribs + 1)
        mb.box(u - rib_w / 2, u + rib_w / 2, -0.12, 0.0, 0.0, h, concrete, skip=("back",))
    build_ledge(mb, w, h - 0.25, concrete)
    mb.finish()
