"""Traffic signal: a pole with a three-lens head (red over amber over green) facing -Y in
Blender (+Z at runtime: the layout turns it toward approaching traffic). Facade-shaded: the
lenses are `fixture(signal=True)` faces whose on/off state the facade shader computes from
the shared clock and the instance's junction offset and phase (src/materials/facade.ts), so
every signal in the city is one instanced draw and stays in step with the traffic."""
from lib.mesh import MeshBuilder
from lib.surface import fixture, plan_uv, surf


def generate(ctx):
    h = ctx.p("height", 3.4)
    hw, hd, hh = ctx.p("head_width", 0.36), ctx.p("head_depth", 0.28), ctx.p("head_height", 1.05)
    lens = ctx.p("lens", 0.24)
    mm, ms = surf(ctx, "metal", 0.0, 0.2)
    mb = MeshBuilder(ctx.name)
    r = ctx.p("pole_radius", 0.07)
    mb.box(-r, r, -r, r, 0.0, h, mm, None, ("bottom",), ms, plan_uv)
    # Head: dark housing in front of the pole top, lenses on its front, a hood over each.
    y0 = -r - hd
    z0 = h - hh + 0.25
    mb.box(-hw / 2, hw / 2, y0, -r, z0, z0 + hh, mm, None, (), ms, plan_uv)
    pitch = hh / 3
    for k, color in enumerate(("cyan", "sodium", "red")):    # green, amber, red from the bottom
        fm, fs = fixture(ctx, color, signal=True)
        zc = z0 + pitch * (k + 0.5)
        y = y0 - 0.004
        mb.quad([(-lens / 2, y, zc - lens / 2), (lens / 2, y, zc - lens / 2), (lens / 2, y, zc + lens / 2), (-lens / 2, y, zc + lens / 2)],
                fm, None, fs, plan_uv)
        mb.box(-lens / 2 - 0.03, lens / 2 + 0.03, y0 - 0.14, y0 - 0.01, zc + lens / 2, zc + lens / 2 + 0.03, mm, None, (), ms, plan_uv)
    mb.finish()
    ctx.meta.update(height=z0 + hh, footprint=[hw, hd + 2 * r], shader="facade", family="signal")
