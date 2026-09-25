"""Kit: window = metal frame + glass pane (dark or emissive).

Building generators reuse build_window(); generate() builds a standalone
piece for previewing the kit element on its own."""
from lib.materials import material
from lib.mesh import MeshBuilder


def frame_material(ctx):
    return material(ctx, "M_metal_dark", "metal_dark", roughness=0.5, metallic=0.6)


def glass_material(ctx):
    return material(ctx, "M_glass_dark", "glass_dark", roughness=0.15, metallic=0.2)


def lit_material(ctx, color_name, strength=4.0):
    return material(ctx, f"M_lit_{color_name}", "glass_dark", roughness=0.3,
                    emission=color_name, emission_strength=strength)


def build_window(mb, u0, u1, z0, z1, frame_mat, pane_mat, xf=None, frame=0.08, depth=0.12):
    """Frame protrudes `depth` in front of the wall plane. Its front is a ring of four
    trapezoids around the pane, coplanar with it and sharing its corners, so nothing
    overlaps the pane (no z-fighting) and there are no T-junctions.
    Back face is skipped (it is inside the wall)."""
    mb.box(u0 - frame, u1 + frame, -depth, 0.0, z0 - frame, z1 + frame, frame_mat, xf, skip=("back", "front"))
    y = -depth
    outer = [(u0 - frame, y, z0 - frame), (u1 + frame, y, z0 - frame), (u1 + frame, y, z1 + frame), (u0 - frame, y, z1 + frame)]
    inner = [(u0, y, z0), (u1, y, z0), (u1, y, z1), (u0, y, z1)]
    for i in range(4):
        j = (i + 1) % 4
        mb.quad([outer[i], outer[j], inner[j], inner[i]], frame_mat, xf)
    mb.quad(inner, pane_mat, xf)


def generate(ctx):
    w = ctx.p("width", 1.4)
    h = ctx.p("height", 1.8)
    pane = lit_material(ctx, ctx.p("lit_color", "warm_interior")) if ctx.p("lit", False) else glass_material(ctx)
    mb = MeshBuilder(ctx.name)
    build_window(mb, -w / 2, w / 2, 0.0, h, frame_material(ctx), pane)
    mb.finish()
