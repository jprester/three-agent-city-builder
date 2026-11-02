"""Low-poly road vehicles, +Z forward at runtime. Paint/glass/rubber are subtypes
of the shared metal surface, so wheels and glazing do not add material draws."""
from math import cos, sin, tau
from lib.mesh import MeshBuilder
from lib.surface import fixture, plan_uv, surf

PAINTS = ("paint_mint", "paint_salmon", "paint_cream", "paint_blue")   # P_PAINT order


def generate(ctx):
    L, W = ctx.p("length", 4.4), ctx.p("width", 1.8)
    body_h, roof_h = ctx.p("body_height", 0.8), ctx.p("roof_height", 1.45)
    tint = ctx.p("tint", 0.5)
    mb = MeshBuilder(ctx.name)
    bm, bs = surf(ctx, "metal", 0.25, tint)
    # The shader paints by tint (P_PAINT in src/materials/facade.ts); the preview matches it.
    bs = (bs[0], ctx.color(PAINTS[min(int(tint * 4), 3)]))
    gm, gs = surf(ctx, "metal", 0.5, tint)
    rm, rs = surf(ctx, "metal", 0.75, tint)
    mm, ms = surf(ctx, "metal", 0.0, tint)
    wheel_r, wheel_w = ctx.p("wheel_radius", 0.31), ctx.p("wheel_width", 0.18)
    axle = L * ctx.p("axle_share", 0.32)
    bevel = ctx.p("body_bevel", 0.12)
    # The lower side panels stop at each wheel arch, rather than hiding the tires in a box.
    mb.box(-W / 2 + bevel, W / 2 - bevel, -L / 2, L / 2, wheel_r * 1.8, body_h, bm, surf=bs, uvf=plan_uv)
    for y0, y1 in ((-L / 2, -axle - wheel_r), (-axle + wheel_r, axle - wheel_r), (axle + wheel_r, L / 2)):
        mb.box(-W / 2 + bevel, W / 2 - bevel, y0, y1, 0.22, wheel_r * 1.8, bm, surf=bs, uvf=plan_uv)
    n = ctx.p("wheel_segments", 12)
    for side in (-1, 1):
        for y in (-axle, axle):
            x0, x1 = side * (W / 2 - wheel_w), side * W / 2
            ring = [(y + wheel_r * cos(tau * i / n), wheel_r + wheel_r * sin(tau * i / n)) for i in range(n)]
            for i in range(n):
                a, b = ring[i], ring[(i + 1) % n]
                pts = [(x0, *a), (x0, *b), (x1, *b), (x1, *a)]
                mb.quad(pts if side > 0 else pts[::-1], rm, surf=rs, uvf=plan_uv)
            pts = [(x1, *a) for a in ring]
            mb.quad(pts if side > 0 else pts[::-1], rm, surf=rs, uvf=plan_uv)
            hub = [(x1 + side * 0.002, y + wheel_r * 0.48 * cos(tau * i / n), wheel_r + wheel_r * 0.48 * sin(tau * i / n)) for i in range(n)]
            mb.quad(hub if side > 0 else hub[::-1], mm, surf=ms, uvf=plan_uv)
    c0, c1 = ctx.p("cabin", [-0.9, 1.3])
    slope = ctx.p("windscreen_slope", 0.42)
    low, high = W / 2 - bevel, W / 2 - ctx.p("roof_inset", 0.22)
    # Trapezoidal cabin: sloped windscreen and rear glass, painted roof and pillars.
    pts = [(-low,c0,body_h),(low,c0,body_h),(low,c1,body_h),(-low,c1,body_h),
           (-high,c0+slope,roof_h),(high,c0+slope,roof_h),(high,c1-slope,roof_h),(-high,c1-slope,roof_h)]
    for ids in ((0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)):
        face = [pts[i] for i in ids]
        mb.quad(face, bm, surf=bs, uvf=plan_uv)
        # A raised inset leaves visible painted pillars around each pane.
        center = [sum(p[k] for p in face)/4 for k in range(3)]
        normal = (0,-0.006,0) if ids[0] == 0 else (0,0.006,0) if ids[0] == 2 else (0.006,0,0) if ids[0] == 1 else (-0.006,0,0)
        inset = [tuple(center[k] + (p[k]-center[k])*0.85 + normal[k] for k in range(3)) for p in face]
        # Cargo vans have solid rear quarters with a small front side window.
        if ctx.p("cargo", False) and ids[0] in (1,3):
            lerp = lambda a, b: tuple(a[k] + (b[k] - a[k]) * ctx.p("cargo_window_share", 0.28) for k in range(3))
            if ids[0] == 1:
                inset[1], inset[2] = lerp(inset[0], inset[1]), lerp(inset[3], inset[2])
            else:
                inset[0], inset[3] = lerp(inset[1], inset[0]), lerp(inset[2], inset[3])
        mb.quad(inset, gm, surf=gs, uvf=plan_uv)
    mb.quad([pts[i] for i in (4,5,6,7)], bm, surf=bs, uvf=plan_uv)
    for side in (-1,1):
        x = side * (low + 0.006)
        mb.box(x - 0.012, x + 0.012, 0.25, 0.5, body_h - 0.12, body_h - 0.08, mm, surf=ms, uvf=plan_uv)
        mb.box(x - 0.015, x + 0.015, -0.03, 0.0, 0.28, body_h, rm, surf=rs, uvf=plan_uv)
    hm, hs = fixture(ctx, "white", strip=True)
    tm, ts = fixture(ctx, "red", strip=True)
    for y in (-L / 2, L / 2):
        mb.box(-low, low, y - 0.025, y + 0.025, 0.3, 0.4, rm, surf=rs, uvf=plan_uv)
    for sx in (-1,1):
        x = sx * (W / 2 - 0.3)
        mb.box(x - 0.16,x + 0.16,-L/2-0.02,-L/2,0.6,0.73,hm,surf=hs,uvf=plan_uv)
        mb.box(x - 0.17,x + 0.17,L/2,L/2+0.02,0.6,0.73,tm,surf=ts,uvf=plan_uv)
    sign_h = ctx.p("taxi_sign_height", 0.18) if ctx.p("roof_sign", False) else 0
    if sign_h:
        sm, ss = fixture(ctx, "sodium", strip=True)
        mb.box(-0.3,0.3,-0.1,0.1,roof_h,roof_h+sign_h,sm,skip=("bottom",),surf=ss,uvf=plan_uv)
    mb.finish()
    ctx.meta.update(footprint=[W,L+0.05],height=roof_h+sign_h,shader="facade",family="vehicle")
