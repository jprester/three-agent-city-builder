"""Street and park tree: a thin trunk and a crown of a few overlapping tapered octagonal
prisms (a cheap blob that reads as foliage at night). Crowns use the `foliage` surface; the
trunk uses `metal` (dark). All tunables are def params."""
from lib.building import prism
from lib.mesh import MeshBuilder
from lib.surface import surf


def generate(ctx):
    rng = ctx.rng
    height = ctx.p("height", 7.0)
    radius = ctx.p("radius", 2.4)
    trunk = ctx.p("trunk", 0.35)
    mb = MeshBuilder(ctx.name)
    tm, ts = surf(ctx, "metal", 0.0, 0.3)
    fm, fs = surf(ctx, "foliage", 0.0, ctx.p("tint", 0.5))
    base = height * ctx.p("crown_base", 0.35)
    mb.box(-trunk / 2, trunk / 2, -trunk / 2, trunk / 2, 0.0, base + 0.5, tm, None, ("bottom",), ts)
    # Crown: lobes around the trunk top, each a short tapered prism.
    # Each lobe flares out then tapers (widest a third of the way up), offset from the trunk,
    # so together they read as a lumpy round crown rather than one cone.
    for k in range(ctx.p("lobes", 4)):
        r = radius * rng.uniform(0.45, 0.65)
        ox, oy = rng.uniform(-0.55, 0.55) * radius, rng.uniform(-0.55, 0.55) * radius
        z0 = base + rng.uniform(0.0, 0.3) * (height - base)
        z1 = min(height, z0 + (height - base) * rng.uniform(0.5, 0.75))
        zm = z0 + (z1 - z0) * 0.35
        prism(mb, fm, fs, ox, oy, z0, zm, r * 0.55, 8, top=False, r_top=r)
        prism(mb, fm, fs, ox, oy, zm, z1, r, 8, top=True, r_top=r * 0.3)
    mb.finish()
    ctx.meta.update(footprint=[radius * 2, radius * 2], height=height, shader="facade")
