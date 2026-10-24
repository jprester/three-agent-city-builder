"""Setback tower: storefront and office base, a shaft of photographic facade ("atlas"
surface: the runtime maps one of the tower texture bundles' facades at real scale) that
steps in at each tier, and a crown that differs per variant. Scalable: the layout stretches
towers to 150-400 m and the facade shader keeps floors at their real height.

Crowns (param "crown"):
  flat      plain parapet, rooftop plant
  band      lit fixture band (use sparingly)
  stepped   two small setbacks and a mast
  spire     slim spire with an aviation light
  plant     tall louvred mechanical floor
  slant     roof sloping down to one side
  lantern   dark ribbed crown with a warm/white lit band and a tapered cap (IFC-like)
  lattice   open white/steel lattice cage above the roof (Bank of China-like)
Accents (param "accent"): "corners" (LED strips on every tier's vertical edges) or
"stripes" (two vertical LED stripes on the front and back faces), in "accent_color"
(facade.json fixture_colors). "screen": a video screen on the lowest tier's front,
covering that fraction of the face width (unused by current defs: the layout's vertical
scaling would stretch it; tower billboards come from the layout's sign zones). Every crown gets red aviation lights.

Landmarks: `scalable: false` keeps the generated height (the layout stops stretching it),
`landmark: true` reserves it for the layout's rare landmark placement, and
`crown_signs: false` keeps the crown architecture free of brand lettering. `exoskeleton`
adds diagonal braces and corner columns over every tier (BOC-like). Width and depth are
whole curtain cells (1.5 m)."""
import math

from lib.building import ac_cluster, antenna_cluster, aviation_lights, cell, corner_strips, crane, face_stripes, flat_roof, mast, screen, side_frame, walls
from lib.architecture import tower_structure
from lib.mesh import MeshBuilder
from lib.surface import fixture, plan_uv, surf


def generate(ctx):
    cw, ch = cell(ctx, "curtain")
    _, oh = cell(ctx, "office")
    _, ph = cell(ctx, "podium")
    W = ctx.p("width_cells", 22) * cw
    D = ctx.p("depth_cells", 20) * cw
    tint = ctx.p("tint", 0.6)
    height = ctx.p("height", 180.0)
    crown = ctx.p("crown", "flat")
    mb = MeshBuilder(ctx.name)

    base_top = ph + ctx.p("base_floors", 2) * oh
    walls(mb, ctx, W, D, 0.0, ph, 0.0, [("podium", 1.0, tint), ("podium", 0.7, tint), ("podium", 0.5, tint), ("podium", 0.7, tint)])
    walls(mb, ctx, W, D, ph, base_top, ph, [("office", "grid", tint)] * 4)

    z = base_top
    w, d = W, D
    shaft = height - base_top - 6.0
    tiers = ctx.p("tiers", [[0.6, 1], [0.28, 3], [0.12, 5]])
    tier_meta = []
    for frac, inset in tiers:
        flat_roof(mb, ctx, w, d, z, tint, parapet=0.6)   # ledge left by the previous tier
        w, d = W - 2 * inset * cw, D - 2 * inset * cw
        h = max(ch, round(frac * shaft / ch) * ch)
        # [z0, z1, setback of this tier's walls from the footprint edge] for sign placement.
        tier_meta.append([round(z, 3), round(z + h, 3), round(inset * cw, 3)])
        walls(mb, ctx, w, d, z, z + h, z, [("atlas", 1.0, tint)] * 4)
        if ctx.p("exoskeleton", False):
            tower_exoskeleton(mb, ctx, w, d, z, z + h, tint)
        elif ctx.p("structural_ribs", False):
            tower_structure(mb, ctx, w, d, z, z + h, tint)
        accent = ctx.p("accent", None)
        if accent == "corners":
            corner_strips(mb, ctx, w, d, z, z + h, ctx.p("accent_color", "white"))
        elif accent == "stripes":
            face_stripes(mb, ctx, w, d, z, z + h, ctx.p("accent_color", "white"))
        if ctx.p("screen", 0) and frac == tiers[0][0]:
            sh = min(h * 0.45, w * ctx.p("screen", 0.6) * 1.5)
            screen(mb, ctx, w, d, z + h - sh - 6.0, z + h - 6.0, ctx.p("screen", 0.6))
        z += h
        # A dark mechanical band between tiers hides the facade texture's vertical wrap.
        if ctx.p("bands", True):
            walls(mb, ctx, w, d, z, z + 1.2, z, [("metal", 0.0, tint)] * 4)
            z += 1.2

    aviation_lights(mb, ctx, w, d, z)
    top = _crown(mb, ctx, crown, w, d, z, tint)
    if ctx.p("crane", False):
        # Still being topped out: a crane on the roof, jib swung over one side.
        top = max(top, crane(mb, ctx, w * 0.2, d * 0.15, top if crown != "spire" else z + 3.0,
                             ctx.p("crane_height", 22.0), ctx.p("crane_jib", 34.0), ctx.p("crane_angle", 0.6)))
    mb.finish()
    # base: top of the office base (storefront zone below it) for the layout's sign zones.
    ctx.meta.update(footprint=[W, D], height=top, family="tower", scalable=ctx.p("scalable", True), shader="facade", tiers=tier_meta, base=base_top,
                    screen=bool(ctx.p("screen", 0)), landmark=bool(ctx.p("landmark", False)),
                    crownSigns=bool(ctx.p("crown_signs", True)))


def _crown(mb, ctx, crown, w, d, z, tint):
    """Builds the crown; sets meta["roof"]: the level of the roof covering the full top-tier
    footprint, where the brand lettering stands."""
    rng = ctx.rng
    if crown == "band":
        fcol = ctx.facade["fixture_colors"][ctx.p("band_color", "white")]
        # Thin soft LED band (strip fixture), not a hot point-light slab.
        walls(mb, ctx, w, d, z + 0.8, z + 1.3, z, [("fixture", fcol, 1.0)] * 4)
        walls(mb, ctx, w, d, z, z + 0.8, z, [("trim", 0.0, tint)] * 4)
        walls(mb, ctx, w, d, z + 1.3, z + 4.0, z, [("trim", 0.0, tint)] * 4)
        z += 4.0
        flat_roof(mb, ctx, w, d, z, tint, parapet=0.0)
        ctx.meta["roof"] = z
        mast(mb, ctx, 0.0, 0.0, z, ctx.p("mast", 18.0), red=True)
        return z
    if crown == "stepped":
        walls(mb, ctx, w, d, z, z + 3.0, z, [("trim", 0.0, tint)] * 4)
        z += 3.0
        ctx.meta["roof"] = z
        for k in range(2):
            flat_roof(mb, ctx, w, d, z, tint, parapet=0.5)
            w, d = w * 0.7, d * 0.7
            walls(mb, ctx, w, d, z, z + 6.0, z, [("office", "alternate", tint)] * 4)
            z += 6.0
        flat_roof(mb, ctx, w, d, z, tint, parapet=0.4)
        mast(mb, ctx, 0.0, 0.0, z, ctx.p("mast", 14.0), red=True)
        return z
    if crown == "spire":
        walls(mb, ctx, w, d, z, z + 3.0, z, [("trim", 0.0, tint)] * 4)
        z += 3.0
        if ctx.p("spire_band", False):
            fcol = ctx.facade["fixture_colors"][ctx.p("crown_color", "white")]
            walls(mb, ctx, w, d, z, z + 2.0, z, [("fixture", fcol, 1.0)] * 4)
            z += 2.0
        ctx.meta["roof"] = z
        flat_roof(mb, ctx, w, d, z, tint, parapet=0.8)
        sw = min(w, d) * 0.18
        mm, ms = surf(ctx, "metal", 0.0, 0.2)
        mb.box(-sw / 2, sw / 2, -sw / 2, sw / 2, z, z + ctx.p("spire", 40.0), mm, None, ("bottom",), ms, plan_uv)
        mast(mb, ctx, 0.0, 0.0, z + ctx.p("spire", 40.0), 4.0, red=True)
        return z + ctx.p("spire", 40.0)
    if crown == "plant":
        pw, pd = w * 0.8, d * 0.8
        flat_roof(mb, ctx, w, d, z, tint, parapet=1.0)
        ctx.meta["roof"] = z
        walls(mb, ctx, pw, pd, z, z + 7.0, z, [("metal", 0.0, tint)] * 4)
        z += 7.0
        flat_roof(mb, ctx, pw, pd, z, tint, parapet=0.0)
        for k in range(3):
            ac_cluster(mb, ctx, rng.uniform(-pw / 4, pw / 4), rng.uniform(-pd / 4, pd / 4), z, rng.randint(1, 3))
        mast(mb, ctx, pw * 0.3, pd * 0.3, z, 10.0, red=True)
        return z
    if crown == "lantern":
        return _crown_lantern(mb, ctx, w, d, z, tint)
    if crown == "lattice":
        return _crown_lattice(mb, ctx, w, d, z, tint)
    if crown == "slant":
        # Roof plane rising from the front edge to the back (pyramid-free wedge).
        rise = ctx.p("slant", 12.0)
        ctx.meta["roof"] = z
        tm, ts = surf(ctx, "trim", 0.0, tint)
        am, as_ = surf(ctx, "atlas", 1.0, tint)
        x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
        mb.quad([(x0, y0, z), (x1, y0, z), (x1, y1, z + rise), (x0, y1, z + rise)], tm, None, ts, plan_uv)
        mb.quad([(x1, y1, z), (x0, y1, z), (x0, y1, z + rise), (x1, y1, z + rise)], am, None, as_, plan_uv)
        # Side triangles.
        for x, flip in ((x1, False), (x0, True)):
            pts = [(x, y0, z), (x, y1, z), (x, y1, z + rise)]
            mb._face(pts[::-1] if flip else pts, None, am, as_, plan_uv)
        mast(mb, ctx, 0.0, d * 0.3, z + rise, 8.0, red=True)
        return z + rise
    # flat
    walls(mb, ctx, w, d, z, z + 2.0, z, [("trim", 0.0, tint)] * 4)
    z += 2.0
    flat_roof(mb, ctx, w, d, z, tint, parapet=0.9)
    ctx.meta["roof"] = z
    for k in range(4):
        ac_cluster(mb, ctx, rng.uniform(-w / 3, w / 3), rng.uniform(-d / 3, d / 3), z, rng.randint(1, 3))
    antenna_cluster(mb, ctx, -w * 0.25, d * 0.25, z)
    if rng.random() < 0.5:
        mast(mb, ctx, w * 0.3, -d * 0.3, z, rng.uniform(6, 14), red=True)
    return z


def _brace(mb, ctx, xf, u0, z0, u1, z1, material, surface, depth, width):
    """A thin diagonal brace in a facade-local frame. `xf` maps facade (u, y, z) to world;
    the brace box is built in a rotated frame so it follows the diagonal exactly."""
    cx, cz = (u0 + u1) / 2, (z0 + z1) / 2
    length = math.hypot(u1 - u0, z1 - z0)
    ang = math.atan2(z1 - z0, u1 - u0)
    c, s = math.cos(ang), math.sin(ang)

    def brace_xf(x, y, z):
        u = cx + x * c - z * s
        zz = cz + x * s + z * c
        return xf(u, y, zz)

    mb.box(-length / 2, length / 2, -depth, 0.0, -width / 2, width / 2, material, brace_xf,
           ("back", "bottom", "top"), surface, plan_uv)


def tower_exoskeleton(mb, ctx, W, D, z0, z1, tint):
    """Corner columns plus an X of diagonal braces on every face: the Bank of China
    expression. Metal, not emissive; the crown adds its own lit edges where wanted."""
    # Pale concrete/steel, not dark metal: the network has to read against dark glass.
    m, s = surf(ctx, "trim", 0.0, max(tint, 0.75))
    spacing = ctx.p("lattice_spacing", 12.0)
    depth = ctx.p("lattice_depth", 0.45)
    width = ctx.p("lattice_width", 0.30)
    col = 0.6
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * W / 2, sy * D / 2
            mb.box(x - col, x + col, y - col, y + col, z0, z1, m, None, ("bottom", "top"), s, plan_uv)
    for side in range(4):
        fw, xf = side_frame(side, W, D)
        n = max(2, int(round(fw / spacing)))
        bay = fw / n
        for k in range(n):
            u0, u1 = -fw / 2 + k * bay, -fw / 2 + (k + 1) * bay
            _brace(mb, ctx, xf, u0, z0, u1, z1, m, s, depth, width)
            _brace(mb, ctx, xf, u0, z1, u1, z0, m, s, depth, width)


def _crown_lantern(mb, ctx, w, d, z, tint):
    """IFC-like crown: dark mechanical collar, a ribbed cage, a lit band and a cap."""
    fcol = ctx.facade["fixture_colors"][ctx.p("crown_color", "white")]
    m, s = surf(ctx, "metal", 0.0, tint)
    tm, ts = surf(ctx, "trim", 0.0, tint)
    walls(mb, ctx, w, d, z, z + 2.4, z, [("trim", 0.0, tint)] * 4)
    z += 2.4
    cw, cd = w * 0.92, d * 0.92
    walls(mb, ctx, cw, cd, z, z + 11.0, z, [("atlas", 1.0, tint)] * 4)
    # Vertical ribs around the crown, standing just proud of the glass.
    for side in range(4):
        fw, xf = side_frame(side, cw, cd)
        n = max(5, int(round(fw / 2.2)))
        for k in range(n + 1):
            u = -fw / 2 + k * fw / n
            mb.box(u - 0.13, u + 0.13, -0.55, 0.0, z, z + 10.5, m, xf, ("back", "bottom", "top"), s, plan_uv)
    # Four lit corner ribs catch the crown at distance; a wide lit collar and a smaller cap.
    fm, fs = fixture(ctx, ctx.p("crown_color", "white"), strip=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * cw / 2, sy * cd / 2
            mb.box(x - 0.14, x + 0.14, y - 0.14, y + 0.14, z, z + 11.0, fm, None, ("bottom", "top"), fs, plan_uv)
    walls(mb, ctx, cw, cd, z + 11.0, z + 14.0, z + 11.0, [("fixture", fcol, 1.0)] * 4)
    cap_w, cap_d = cw * 0.74, cd * 0.74
    walls(mb, ctx, cap_w, cap_d, z + 14.0, z + 16.6, z + 14.0, [("metal", 0.0, tint)] * 4)
    flat_roof(mb, ctx, cap_w, cap_d, z + 16.6, tint, parapet=0.45)
    ctx.meta["roof"] = z + 16.6
    aviation_lights(mb, ctx, cap_w, cap_d, z + 16.6)
    mast(mb, ctx, 0.0, 0.0, z + 16.6, ctx.p("mast", 12.0), red=True)
    return z + 16.6 + ctx.p("mast", 12.0)


def _crown_lattice(mb, ctx, w, d, z, tint):
    """Open lattice crown: four posts, X braces on each face and a lit top band."""
    fcol = ctx.facade["fixture_colors"][ctx.p("crown_color", "white")]
    # The crown itself is the lit outline; the body lattice below stays pale metal.
    fm, fs = fixture(ctx, ctx.p("crown_color", "white"), strip=True)
    h = ctx.p("lattice_crown_height", 18.0)
    post = 0.55
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * w / 2, sy * d / 2
            mb.box(x - post, x + post, y - post, y + post, z, z + h, fm, None, ("bottom", "top"), fs, plan_uv)
    for side in range(4):
        fw, xf = side_frame(side, w, d)
        _brace(mb, ctx, xf, -fw / 2, z, fw / 2, z + h, fm, fs, 0.4, 0.26)
        _brace(mb, ctx, xf, -fw / 2, z + h, fw / 2, z, fm, fs, 0.4, 0.26)
    # Lit perimeter at the top of the frame, then a small roof cap.
    walls(mb, ctx, w, d, z + h, z + h + 0.9, z + h, [("fixture", fcol, 1.0)] * 4)
    flat_roof(mb, ctx, w, d, z + h + 0.9, tint, parapet=0.4)
    ctx.meta["roof"] = z + h + 0.9
    aviation_lights(mb, ctx, w, d, z + h + 0.9)
    mast(mb, ctx, 0.0, 0.0, z + h + 0.9, ctx.p("mast", 10.0), red=True)
    return z + h + 0.9 + ctx.p("mast", 10.0)
