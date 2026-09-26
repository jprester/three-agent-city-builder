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
Accents (param "accent"): "corners" (LED strips on every tier's vertical edges) or
"stripes" (two vertical LED stripes on the front and back faces), in "accent_color"
(facade.json fixture_colors). "screen": a video screen on the lowest tier's front,
covering that fraction of the face width. Every crown gets red aviation lights.
Width and depth are whole curtain cells (1.5 m)."""
from lib.building import ac_cluster, antenna_cluster, aviation_lights, cell, corner_strips, crane, face_stripes, flat_roof, mast, screen, walls
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
    walls(mb, ctx, W, D, ph, base_top, ph, [("office", 0.7, tint)] * 4)

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
    ctx.meta.update(footprint=[W, D], height=top, family="tower", scalable=True, shader="facade", tiers=tier_meta,
                    screen=bool(ctx.p("screen", 0)))


def _crown(mb, ctx, crown, w, d, z, tint):
    rng = ctx.rng
    if crown == "band":
        fcol = ctx.facade["fixture_colors"][ctx.p("band_color", "white")]
        walls(mb, ctx, w, d, z, z + 1.2, z, [("fixture", fcol, 0.0)] * 4)
        walls(mb, ctx, w, d, z + 1.2, z + 4.0, z, [("trim", 0.0, tint)] * 4)
        z += 4.0
        flat_roof(mb, ctx, w, d, z, tint, parapet=0.0)
        mast(mb, ctx, 0.0, 0.0, z, ctx.p("mast", 18.0), red=True)
        return z
    if crown == "stepped":
        walls(mb, ctx, w, d, z, z + 3.0, z, [("trim", 0.0, tint)] * 4)
        z += 3.0
        for k in range(2):
            flat_roof(mb, ctx, w, d, z, tint, parapet=0.5)
            w, d = w * 0.7, d * 0.7
            walls(mb, ctx, w, d, z, z + 6.0, z, [("office", 0.4, tint)] * 4)
            z += 6.0
        flat_roof(mb, ctx, w, d, z, tint, parapet=0.4)
        mast(mb, ctx, 0.0, 0.0, z, ctx.p("mast", 14.0), red=True)
        return z
    if crown == "spire":
        walls(mb, ctx, w, d, z, z + 3.0, z, [("trim", 0.0, tint)] * 4)
        z += 3.0
        flat_roof(mb, ctx, w, d, z, tint, parapet=0.8)
        sw = min(w, d) * 0.18
        mm, ms = surf(ctx, "metal", 0.0, 0.2)
        mb.box(-sw / 2, sw / 2, -sw / 2, sw / 2, z, z + ctx.p("spire", 40.0), mm, None, ("bottom",), ms, plan_uv)
        mast(mb, ctx, 0.0, 0.0, z + ctx.p("spire", 40.0), 4.0, red=True)
        return z + ctx.p("spire", 40.0)
    if crown == "plant":
        pw, pd = w * 0.8, d * 0.8
        flat_roof(mb, ctx, w, d, z, tint, parapet=1.0)
        walls(mb, ctx, pw, pd, z, z + 7.0, z, [("metal", 0.0, tint)] * 4)
        z += 7.0
        flat_roof(mb, ctx, pw, pd, z, tint, parapet=0.0)
        for k in range(3):
            ac_cluster(mb, ctx, rng.uniform(-pw / 4, pw / 4), rng.uniform(-pd / 4, pd / 4), z, rng.randint(1, 3))
        mast(mb, ctx, pw * 0.3, pd * 0.3, z, 10.0, red=True)
        return z
    if crown == "slant":
        # Roof plane rising from the front edge to the back (pyramid-free wedge).
        rise = ctx.p("slant", 12.0)
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
    for k in range(4):
        ac_cluster(mb, ctx, rng.uniform(-w / 3, w / 3), rng.uniform(-d / 3, d / 3), z, rng.randint(1, 3))
    antenna_cluster(mb, ctx, -w * 0.25, d * 0.25, z)
    if rng.random() < 0.5:
        mast(mb, ctx, w * 0.3, -d * 0.3, z, rng.uniform(6, 14), red=True)
    return z
