"""Optional architectural detail for selected foreground building variants.
Openings carry the existing procedural glass shader on a recessed plane; wall and
reveal faces are real geometry. No overlapping front wall remains behind an opening.
"""
from lib.building import side_frame
from lib.surface import facade_uv, surf


def recessed_front(mb, ctx, W, D, z0, z1, vbase, kinds, cell_size, rect, depth):
    """Four walls; the street face has recessed openings aligned to shader cells."""
    for side, (kind, fill, tint) in enumerate(kinds):
        fw, xf = side_frame(side, W, D)
        uvf = facade_uv(fw, vbase)
        m, s = surf(ctx, kind, fill, tint)
        tm, ts = surf(ctx, "trim", 0.0, tint)
        def front(x0, x1, low, high, y=0.0):
            if x1 > x0 and high > low:
                mb.quad([(x0, y, low), (x1, y, low), (x1, y, high), (x0, y, high)], m, xf, s, uvf)
        if side != 0:
            front(-fw / 2, fw / 2, z0, z1)
            continue
        cw, ch = cell_size
        count = int(round(fw / cw))
        for row in range(int(round((z1 - z0) / ch))):
            bottom = z0 + row * ch
            for col in range(count):
                left = -fw / 2 + col * cw
                right = min(fw / 2, left + cw)
                x0, x1 = left + rect[0], min(right, left + rect[1])
                low, high = bottom + rect[2], bottom + rect[3]
                front(left, right, bottom, low)
                front(left, right, high, bottom + ch)
                front(left, x0, low, high)
                front(x1, right, low, high)
                front(x0, x1, low, high, depth)
                # Inward-facing jambs, sill and lintel.
                for pts in (
                    [(x0, 0, low), (x0, depth, low), (x0, depth, high), (x0, 0, high)],
                    [(x1, depth, low), (x1, 0, low), (x1, 0, high), (x1, depth, high)],
                    [(x0, 0, low), (x1, 0, low), (x1, depth, low), (x0, depth, low)],
                    [(x0, depth, high), (x1, depth, high), (x1, 0, high), (x0, 0, high)],
                ):
                    mb.quad(pts, tm, xf, ts, uvf)


def balcony_rail(mb, ctx, xf, uvf, x0, x1, y, z):
    m, s = surf(ctx, "metal", 0.0, 0.4)
    thick = ctx.p("rail_thickness", 0.045)
    height = ctx.p("rail_height", 1.0)
    for h in (height * 0.5, height):
        mb.box(x0, x1, y, y + thick, z + h, z + h + thick, m, xf, (), s, uvf)
    for u in (x0, (x0 + x1) / 2, x1 - thick):
        mb.box(u, u + thick, y, y + thick, z, z + height, m, xf, ("bottom", "top"), s, uvf)


def service_details(mb, ctx, W, D, ph, top, tint):
    fw, xf = side_frame(0, W, D)
    uvf = facade_uv(fw, ph)
    m, s = surf(ctx, "metal", 0.0, tint)
    radius = ctx.p("pipe_radius", 0.07)
    for u in (-fw / 2 + ctx.p("pipe_inset", 0.32), fw / 2 - ctx.p("pipe_inset", 0.32)):
        mb.box(u - radius, u + radius, -radius * 3, -radius, ph, top, m, xf, ("bottom", "top"), s, uvf)
        spacing = ctx.p("pipe_bracket_spacing", 6.0)
        for k in range(int((top - ph) / spacing)):
            z = ph + k * spacing
            mb.box(u - radius * 1.8, u + radius * 1.8, -radius * 3.4, 0, z, z + radius, m, xf, ("back",), s, uvf)


def tower_structure(mb, ctx, W, D, z0, z1, tint):
    """Structural ribs and louvred belt, deliberately much coarser than window bays."""
    m, s = surf(ctx, "metal", 0.0, tint)
    tm, ts = surf(ctx, "trim", 0.0, tint)
    spacing = ctx.p("rib_spacing", 6.0)
    depth = ctx.p("rib_depth", 0.32)
    width = ctx.p("rib_width", 0.16)
    for side in range(4):
        fw, xf = side_frame(side, W, D)
        uvf = facade_uv(fw, z0)
        n = max(1, int(fw / spacing))
        for k in range(n + 1):
            u = -fw / 2 + width / 2 + k * (fw - width) / n
            mb.box(u - width / 2, u + width / 2, -depth, 0, z0, z1, tm, xf, ("back",), ts, uvf)
        belt = ctx.p("mechanical_belt_height", 1.8)
        for k in range(ctx.p("louvre_count", 4)):
            z = z1 - belt + k * belt / ctx.p("louvre_count", 4)
            mb.box(-fw / 2, fw / 2, -depth * 1.3, 0, z, z + belt * 0.13, m, xf, ("back",), s, uvf)
