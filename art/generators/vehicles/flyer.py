"""Flying vehicle hull: a low wedge body with a lit cabin strip, four thruster pods with
glowing undersides, and navigation lights (blinking red, white strobe). Front faces -Y."""
from lib.building import prism
from lib.mesh import MeshBuilder
from lib.surface import fixture, plan_uv, surf


def generate(ctx):
    L, W, H = ctx.p("length", 7.0), ctx.p("width", 3.2), ctx.p("height", 1.6)
    mb = MeshBuilder(ctx.name)
    bm, bs = surf(ctx, "metal", 0.0, ctx.p("tint", 0.3))
    # Wedge body: a box whose top slopes down toward the nose.
    x0, x1, y0, y1 = -W / 2, W / 2, -L / 2, L / 2
    nose = H * 0.45
    mb.quad([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)][::-1], bm, None, bs, plan_uv)       # bottom
    mb.quad([(x0, y0, nose), (x1, y0, nose), (x1, y1, H), (x0, y1, H)][::-1], bm, None, bs, plan_uv)  # top
    mb.quad([(x0, y0, 0), (x1, y0, 0), (x1, y0, nose), (x0, y0, nose)], bm, None, bs, plan_uv)         # nose
    mb.quad([(x1, y1, 0), (x0, y1, 0), (x0, y1, H), (x1, y1, H)], bm, None, bs, plan_uv)               # tail
    mb.quad([(x1, y0, 0), (x1, y1, 0), (x1, y1, H), (x1, y0, nose)], bm, None, bs, plan_uv)            # right
    mb.quad([(x0, y1, 0), (x0, y0, 0), (x0, y0, nose), (x0, y1, H)], bm, None, bs, plan_uv)            # left
    # Cabin glow strip along the sides and the front screen.
    cm, cs = fixture(ctx, ctx.p("cabin_light", "white"))   # bright: must read from far away
    for sx, face in ((1, "right"), (-1, "left")):
        x = sx * (W / 2 + 0.01)
        mb.box(min(x, x - sx * 0.02), max(x, x - sx * 0.02), y0 + L * 0.15, y0 + L * 0.75, nose * 1.05, nose * 1.05 + 0.45, cm, None, (), cs, plan_uv)
    # Thruster pods with glowing undersides.
    tm, ts = fixture(ctx, ctx.p("thruster", "blue"))   # point glow: blooms at distance
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = sx * (W / 2 + 0.5), sy * L * 0.3
            prism(mb, bm, bs, px, py, 0.1, 0.7, 0.45, 6)
            prism(mb, tm, ts, px, py, 0.05, 0.1, 0.4, 6, top=False)
            mb.box(px - 0.05 if sx > 0 else px, px if sx > 0 else px + 0.05, py - 0.1, py + 0.1, 0.35, 0.45, bm, None, (), bs, plan_uv)
    # Navigation lights: blinking red at the tail fin, white at the nose.
    rm, rs = fixture(ctx, "red")
    mb.box(-0.15, 0.15, y1 - 0.3, y1, H, H + 0.25, rm, None, ("bottom",), rs, plan_uv)
    # Tail light bar across the whole stern.
    mb.box(x0 + 0.2, x1 - 0.2, y1, y1 + 0.03, H * 0.55, H * 0.75, rm, None, ("front",), rs, plan_uv)
    wm, ws = fixture(ctx, "white")
    mb.box(-0.2, 0.2, y0 - 0.02, y0, nose - 0.2, nose - 0.05, wm, None, ("back",), ws, plan_uv)
    mb.finish()
    ctx.meta.update(footprint=[W + 1.9, L], height=H + 0.25, shader="facade", family="vehicle")
