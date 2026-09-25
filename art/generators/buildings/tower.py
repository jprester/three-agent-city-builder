"""Building: rectangular tower with a tall ground floor, gridded windows,
ledge bands, a storefront sign strip and rooftop clutter.

All tunables come from the def's params; see art/defs/buildings/*.json."""
from kit.wall_panel import build_ledge
from kit.window_frame import build_window, frame_material, glass_material, lit_material
from lib.materials import material
from lib.mesh import MeshBuilder
from lib.transforms import facade_width, facade_xf


def generate(ctx):
    w = ctx.p("width", 12.0)
    d = ctx.p("depth", 10.0)
    floors = ctx.p("floors", 12)
    floor_h = ctx.p("floor_height", 3.2)
    base_h = ctx.p("base_height", 4.5)
    win_w = ctx.p("window_width", 1.4)
    win_h = ctx.p("window_height", 1.8)
    spacing = ctx.p("window_spacing", 2.2)
    margin = ctx.p("facade_margin", 0.8)
    lit_ratio = ctx.p("lit_ratio", 0.35)
    lit_colors = ctx.p("lit_colors", {"warm_interior": 1})
    ledge_every = ctx.p("ledge_every", 4)
    roof_units = ctx.p("roof_units", 3)
    height = base_h + floors * floor_h

    body = material(ctx, f"M_{ctx.p('body_color', 'concrete')}", ctx.p("body_color", "concrete"), roughness=0.9)
    trim = material(ctx, "M_concrete_trim", "concrete_dark", roughness=0.85)
    frame = frame_material(ctx)
    glass = glass_material(ctx)
    lit = {name: lit_material(ctx, name, ctx.p("emission_strength", 4.0)) for name in lit_colors}
    metal = frame

    mb = MeshBuilder(ctx.name)
    mb.box(-w / 2, w / 2, -d / 2, d / 2, 0.0, height, body, skip=("bottom",))

    for side in range(4):
        fw = facade_width(side, w, d)
        xf = facade_xf(side, w, d)
        cols = max(1, int((fw - 2 * margin) // spacing))
        start = -(cols - 1) * spacing / 2

        for f in range(floors):
            z0 = base_h + f * floor_h + (floor_h - win_h) / 2
            for c in range(cols):
                u = start + c * spacing
                pane = lit[ctx.weighted_choice(lit_colors)] if ctx.rng.random() < lit_ratio else glass
                build_window(mb, u - win_w / 2, u + win_w / 2, z0, z0 + win_h, frame, pane, xf)

        for f in range(0, floors, ledge_every):
            build_ledge(mb, fw, base_h + f * floor_h - 0.25, trim, xf)

        if side == 0:  # storefront sign on the front only
            sign = lit_material(ctx, ctx.p("sign_color", "neon_magenta"), ctx.p("sign_strength", 6.0))
            mb.box(-fw / 2 + 0.6, fw / 2 - 0.6, -0.25, 0.0, base_h - 1.3, base_h - 0.7, sign, xf, skip=("back",))

    # Parapet cap and rooftop units.
    mb.box(-w / 2 - 0.1, w / 2 + 0.1, -d / 2 - 0.1, d / 2 + 0.1, height, height + 0.4, trim, skip=("bottom",))
    top = height + 0.4
    for _ in range(roof_units):
        uw, ud, uh = ctx.rng.uniform(1.2, 3.0), ctx.rng.uniform(1.2, 3.0), ctx.rng.uniform(0.8, 2.2)
        cx = ctx.rng.uniform(-w / 2 + uw / 2 + 0.5, w / 2 - uw / 2 - 0.5)
        cy = ctx.rng.uniform(-d / 2 + ud / 2 + 0.5, d / 2 - ud / 2 - 0.5)
        mb.box(cx - uw / 2, cx + uw / 2, cy - ud / 2, cy + ud / 2, top, top + uh, metal, skip=("bottom",))
    if ctx.rng.random() < 0.6:
        ax, ay = ctx.rng.uniform(-w / 3, w / 3), ctx.rng.uniform(-d / 3, d / 3)
        mb.box(ax - 0.08, ax + 0.08, ay - 0.08, ay + 0.08, top, top + ctx.rng.uniform(4, 9), metal, skip=("bottom",))

    mb.finish()
    # Blender X/Y become three.js X/Z; front (-Y) becomes +Z.
    ctx.meta.update(footprint=[w, d], height=top, scalable=ctx.p("scalable", False))
