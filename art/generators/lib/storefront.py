"""Street-facing shop bays with real jambs, lintels and thresholds.

Keep facade-meter UVs on the inset back wall, so the runtime can vary shutters,
doors and interiors without extra materials. No random draws: adding shops must
not rearrange the existing building's balconies, signs or rooftop clutter.
"""
import math
from lib.building import side_frame
from lib.surface import facade_uv, surf


def build_shopfront(mb, ctx, W, D, height, kinds):
    cw = ctx.facade["cells"]["podium"]["w"]
    jamb = ctx.p("shop_jamb", 0.3)
    sill = ctx.p("shop_sill", 0.15)
    head = ctx.p("shop_head", 3.25)
    depth = ctx.p("shop_recess", 0.45)
    for side, (kind, fill, tint) in enumerate(kinds):
        fw, xf = side_frame(side, W, D)
        uvf = facade_uv(fw, 0.0)
        m, s = surf(ctx, kind, fill, tint)
        tm, ts = surf(ctx, "trim", 0.0, tint)

        def wall(x0, x1, z0, z1, y=0.0):
            if x1 > x0 and z1 > z0:
                mb.quad([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], m, xf, s, uvf)

        if side != 0 or depth <= 0:
            wall(-fw / 2, fw / 2, 0.0, height)
            continue
        for bay in range(math.ceil(fw / cw)):
            left = -fw / 2 + bay * cw
            right = min(fw / 2, left + cw)
            x0, x1 = left + jamb, right - jamb
            if x1 <= x0:
                wall(left, right, 0.0, height)
                continue
            wall(left, right, 0.0, sill)
            wall(left, right, head, height)
            wall(left, x0, sill, head)
            wall(x1, right, sill, head)
            wall(x0, x1, sill, head, depth)
            # Faces point into the opening; there is no coplanar wall behind the shop.
            for points in (
                [(x0, 0, sill), (x0, depth, sill), (x0, depth, head), (x0, 0, head)],
                [(x1, depth, sill), (x1, 0, sill), (x1, 0, head), (x1, depth, head)],
                [(x0, 0, sill), (x1, 0, sill), (x1, depth, sill), (x0, depth, sill)],
                [(x0, depth, head), (x1, depth, head), (x1, 0, head), (x0, 0, head)],
            ):
                mb.quad(points, tm, xf, ts, uvf)
