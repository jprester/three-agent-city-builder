"""Residential point tower (Hong Kong private housing, see ref-hk-residential-night*.jpg):
a slender 30-50 floor shaft on a shop podium. The plan is a grid of residential cells with
corner notches and deep slots cut into the faces; the slots run the full height and read
as dark vertical lines at night. Walls use the `tower_res` surface (residential windows,
more of them lit, a per-building cladding color). Balcony stacks on some wing faces, AC
units everywhere, pale corner fins on the outer corners, a plant-room crown with a water
tank and masts.

Dimensions are whole residential cells so the shaded windows line up with the plan."""
from lib.building import aviation_lights, cell, flat_roof, mast, side_frame, walls, water_tank
from lib.architecture import balcony_rail
from lib.mesh import MeshBuilder
from lib.surface import facade_uv, fixture, plan_uv, surf

# Facade sides (lib.transforms): outward normal of each side as a grid step.
_STEP = {0: (0, -1), 1: (1, 0), 2: (0, 1), 3: (-1, 0)}


def _plan(nx, ny, notch, slots, slot_depth, slot_width):
    """Cell grid: None = occupied, else the kind of empty cell ('notch', 'slot')."""
    empty = {}
    for i in range(nx):
        for j in range(ny):
            cx, cy = min(i, nx - 1 - i), min(j, ny - 1 - j)
            if cx < notch and cy < notch:
                empty[(i, j)] = "notch"
    for side in slots:
        along = nx if side % 2 == 0 else ny
        a0 = (along - slot_width) // 2
        for a in range(a0, a0 + slot_width):
            for d in range(slot_depth):
                i, j = {0: (a, d), 2: (a, ny - 1 - d), 1: (nx - 1 - d, a), 3: (d, a)}[side]
                empty[(i, j)] = "slot"
    return empty


def _runs(nx, ny, empty, side):
    """Wall runs facing `side`: (plane index, start, end, neighbor kind), merged along the
    wall while the neighbor kind stays the same."""
    dx, dy = _STEP[side]
    runs = []
    lines = range(ny) if side % 2 == 0 else range(nx)
    for line in lines:
        cur = None
        span = range(nx) if side % 2 == 0 else range(ny)
        for a in span:
            i, j = (a, line) if side % 2 == 0 else (line, a)
            ni, nj = i + dx, j + dy
            here = (i, j) not in empty
            outside = not (0 <= ni < nx and 0 <= nj < ny)
            kind = None
            if here:
                kind = "out" if outside else empty.get((ni, nj))
            if kind and cur and cur[3] == kind and cur[2] == a:
                cur[2] = a + 1
                continue
            if cur:
                runs.append(tuple(cur))
            cur = [line, a, a + 1, kind] if kind else None
        if cur:
            runs.append(tuple(cur))
    return runs


def _frame(side, line, a0, a1, nx, ny, cw):
    """(facade width, transform) for a wall run in building space."""
    x0, y0 = -nx * cw / 2, -ny * cw / 2
    w = (a1 - a0) * cw
    mid = (a0 + a1) / 2 * cw
    if side == 0:
        return side_frame(0, w, 0.0, x0 + mid, y0 + line * cw)
    if side == 2:
        return side_frame(2, w, 0.0, x0 + mid, y0 + (line + 1) * cw)
    if side == 1:
        return side_frame(1, 0.0, w, x0 + (line + 1) * cw, y0 + mid)
    return side_frame(3, 0.0, w, x0 + line * cw, y0 + mid)


def generate(ctx):
    rng = ctx.rng
    cw, ch = cell(ctx, "residential")
    _, oh = cell(ctx, "office")
    _, ph = cell(ctx, "podium")
    nx, ny = ctx.p("width_bays", 7), ctx.p("depth_bays", 7)
    W, D = nx * cw, ny * cw
    floors = ctx.p("floors", 40)
    tint = ctx.p("tint", 0.5)
    lod = ctx.p("lod", 0)
    mb = MeshBuilder(ctx.name)
    # lod >= 1 drops AC units, rails and balcony fronts into a discarded builder (random draws
    # kept, so nothing else moves); the shader draws the windows either way.
    dmb = MeshBuilder(ctx.name + "_discard") if lod else mb

    # Podium: shops on the street, a car park / clubhouse floor above, roof deck with parapet.
    walls(mb, ctx, W, D, 0.0, ph, 0.0, [("podium", ctx.p("shop_fill", 1.0), tint), ("podium", 0.5, tint),
                                         ("trim", 0.0, tint), ("podium", 0.5, tint)])
    base = ph
    if ctx.p("base_floor", True):
        walls(mb, ctx, W, D, ph, ph + oh, ph, [("office", "alternate", tint)] * 4)
        base = ph + oh
    flat_roof(mb, ctx, W, D, base, tint, parapet=1.1)
    cd = ctx.p("canopy_depth", 2.2)
    fw, xf = side_frame(0, W, D)
    if cd > 0:
        tm, ts = surf(ctx, "trim", 0.0, tint)
        sm, ss = surf(ctx, "soffit", 0.0, 0.0)
        mb.box(-fw / 2, fw / 2, -cd, 0.0, ph - 0.45, ph - 0.1, tm, xf, ("back",), ts, facade_uv(fw, 0.0),
               faces={"bottom": (sm, ss)})

    # Shaft: walls of the notched plan. Slot walls get few openings (bathrooms, stairs), so
    # the slots stay dark; outer and notch walls are full grids.
    empty = _plan(nx, ny, ctx.p("notch", 1), ctx.p("slots", [0, 2]), ctx.p("slot_depth", 2), ctx.p("slot_width", 1))
    top = base + floors * ch
    tm, ts = surf(ctx, "trim", 0.0, tint)
    am, as_ = surf(ctx, "metal", 0.0, 0.5)
    cm, cs = surf(ctx, "cage", 0.0, tint)
    bd = ctx.p("balcony_depth", 1.0)
    fin = ctx.p("fin_width", 0.45)
    for side in range(4):
        for line, a0, a1, kind in _runs(nx, ny, empty, side):
            w, wxf = _frame(side, line, a0, a1, nx, ny, cw)
            uvf = facade_uv(w, base)
            pattern = ctx.p("slot_pattern", "stair") if kind == "slot" else "grid"
            m, s = surf(ctx, "tower_res", pattern, tint, round(w / cw))
            mb.quad([(-w / 2, 0, base), (w / 2, 0, base), (w / 2, 0, top), (-w / 2, 0, top)], m, wxf, s, uvf)
            if kind == "slot":
                continue
            # Pale fins on the run ends: the vertical edges that outline each wing.
            if kind == "out" and fin > 0:
                for u in (-w / 2, w / 2 - fin):
                    mb.box(u, u + fin, -0.3, 0.0, base, top, tm, wxf, ("back", "bottom"), ts, uvf)
            cols = a1 - a0
            balcony = cols >= 2 and kind == "out" and rng.random() < ctx.p("balcony_ratio", 0.35)
            bcol = rng.randrange(cols)
            for c in range(cols):
                u0 = -w / 2 + c * cw
                for f in range(floors):
                    z = base + f * ch
                    if balcony and c == bcol:
                        dmb.box(u0 + 0.15, u0 + cw - 0.15, -bd, 0.0, z, z + 0.15, tm, wxf, ("back",), ts, uvf)
                        balcony_rail(dmb, ctx, wxf, uvf, u0 + 0.15, u0 + cw - 0.15, -bd, z + 0.15)
                        continue
                    r = rng.random()
                    if r < ctx.p("ac_ratio", 0.22):
                        ax = u0 + cw / 2 + rng.choice((-0.8, 0.8))
                        dmb.box(ax - 0.4, ax + 0.4, -0.55, 0.0, z + 0.2, z + 0.75, am, wxf, ("back",), as_, uvf)
                    elif r < ctx.p("ac_ratio", 0.22) + ctx.p("cage_ratio", 0.03) and f < floors // 3:
                        dmb.box(u0 + 0.55, u0 + cw - 0.55, -0.4, 0.0, z + 0.7, z + 2.5, cm, wxf, ("back",), cs, uvf)

    # Roof of the shaft: one slab per occupied cell row run, parapets on the outer outline.
    x0, y0 = -W / 2, -D / 2
    rm, rs = surf(ctx, "roof", 0.0, tint)
    for j in range(ny):
        i = 0
        while i < nx:
            if (i, j) in empty:
                i += 1
                continue
            k = i
            while k < nx and (k, j) not in empty:
                k += 1
            ya, yb, xa, xb = y0 + j * cw, y0 + (j + 1) * cw, x0 + i * cw, x0 + k * cw
            mb.quad([(xa, ya, top), (xb, ya, top), (xb, yb, top), (xa, yb, top)], rm, None, rs, plan_uv)
            i = k
    par = ctx.p("parapet", 1.4)
    for side in range(4):
        for line, a0, a1, kind in _runs(nx, ny, empty, side):
            w, wxf = _frame(side, line, a0, a1, nx, ny, cw)
            mb.box(-w / 2, w / 2, 0.0, 0.25, top, top + par, tm, wxf, ("bottom",), ts, facade_uv(w, base))

    # Crown: a plant room on the core, optionally ringed by a lit band, with a water tank and
    # masts on top; aviation lights on the corners of the shaft.
    pw, pd = ctx.p("plant_bays", [3, 3])
    pw, pd = pw * cw, pd * cw
    ptop = top + ctx.p("plant_floors", 2) * ch
    walls(mb, ctx, pw, pd, top, ptop, top, [("trim", 0.0, tint)] * 4)
    flat_roof(mb, ctx, pw, pd, ptop, tint, parapet=0.6)
    if ctx.p("crown_light", False):
        fm, fs = fixture(ctx, "white", strip=True)
        for side in range(4):
            sw, sxf = side_frame(side, pw, pd)
            mb.box(-sw / 2, sw / 2, -0.12, 0.0, ptop - 0.5, ptop - 0.3, fm, sxf, ("back",), fs, facade_uv(sw, top))
    tank_top = water_tank(mb, ctx, -pw * 0.2, 0.0, ptop, ctx.p("tank_size", 2.6))
    roof_top = max(ptop, tank_top)
    for k in range(ctx.p("masts", 2)):
        h = rng.uniform(5.0, 14.0)
        mast(mb, ctx, pw * 0.3 - k * 1.4, pd * 0.25, ptop, h, red=True)
        roof_top = max(roof_top, ptop + h)
    aviation_lights(mb, ctx, W - 2 * ctx.p("notch", 1) * cw if ctx.p("notch", 1) else W, D, top + par, 0.0, 0.0)

    if dmb is not mb:
        dmb.discard()
    mb.finish()
    ctx.meta.update(canopy=cd, depth=max(bd, 0.55), footprint=[W, D], height=ptop, top=roof_top,
                    family="restower", scalable=False, shader="facade")
