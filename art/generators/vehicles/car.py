"""Road vehicles, front at -Y (+Z at runtime, so the traffic system can orient them).

The body is one lofted shell: a 13-point cross-section (sill, side, beltline, shoulder,
glass, roof) swept through stations along the length. Keyframes per body `shape` set the
beltline, roof and taper; extra stations around each axle raise the sill into wheel arches.
Glass faces follow the segment kind (windscreen, cabin, rear window). Paint, glass and
rubber are subtypes of the shared metal surface, so the whole car is one facade draw."""
from math import cos, pi, sin, sqrt, tau

from lib.mesh import MeshBuilder
from lib.surface import fixture, plan_uv, surf

PAINTS = ("paint_mint", "paint_salmon", "paint_cream", "paint_blue")   # P_PAINT order

# Keyframes (s from the nose in meters, beltline z, roof z or None for a crowned panel,
# half-width share, sill z, side glass in the following segment). Lengths are the shapes'
# design lengths; `length` stretches them.
SHAPES = {
    "sedan": dict(length=4.6, axles=(0.95, 3.65), keys=[
        (0.00, 0.70, None, 0.91, 0.38, False), (0.12, 0.80, None, 0.98, 0.30, False),
        (0.55, 0.86, None, 1.00, 0.28, False), (1.32, 0.92, None, 1.00, 0.28, False),
        (2.05, 0.94, 1.42, 1.00, 0.28, True), (2.74, 0.95, 1.44, 1.00, 0.28, False),
        (2.86, 0.95, 1.44, 1.00, 0.28, True), (3.42, 0.96, 1.40, 1.00, 0.28, False),
        (4.05, 0.98, None, 1.00, 0.30, False), (4.48, 0.96, None, 0.98, 0.32, False),
        (4.60, 0.86, None, 0.93, 0.38, False)]),
    "hatch": dict(length=4.0, axles=(0.80, 3.30), keys=[
        (0.00, 0.72, None, 0.91, 0.38, False), (0.12, 0.82, None, 0.98, 0.30, False),
        (0.90, 0.90, None, 1.00, 0.28, False), (1.62, 0.93, 1.45, 1.00, 0.28, True),
        (2.30, 0.94, 1.46, 1.00, 0.28, False), (2.42, 0.94, 1.46, 1.00, 0.28, True),
        (3.42, 0.96, 1.42, 1.00, 0.28, False), (3.84, 0.98, None, 0.99, 0.30, False),
        (3.92, 0.95, None, 0.97, 0.34, False), (4.00, 0.84, None, 0.93, 0.38, False)]),
    # Upright Tokyo taxi: short steep windscreen, tall flat roof, square tail.
    "taxi": dict(length=4.6, axles=(0.95, 3.65), keys=[
        (0.00, 0.74, None, 0.94, 0.36, False), (0.10, 0.82, None, 0.99, 0.30, False),
        (1.38, 0.90, None, 1.00, 0.28, False), (1.86, 0.92, 1.50, 1.00, 0.28, True),
        (2.70, 0.93, 1.50, 1.00, 0.28, False), (2.82, 0.93, 1.50, 1.00, 0.28, True),
        (3.62, 0.94, 1.48, 1.00, 0.28, False), (3.94, 0.97, None, 1.00, 0.30, False),
        (4.50, 0.96, None, 0.99, 0.32, False), (4.60, 0.88, None, 0.95, 0.36, False)]),
    # One-box delivery van: stub nose, windscreen over the front wheels, blind cargo sides.
    "van": dict(length=4.7, axles=(0.85, 3.50), keys=[
        (0.00, 0.84, None, 0.94, 0.40, False), (0.10, 0.94, None, 0.99, 0.32, False),
        (0.38, 1.00, None, 1.00, 0.32, False), (1.02, 1.04, 1.94, 1.00, 0.32, True),
        (1.86, 1.05, 1.96, 1.00, 0.32, False), (4.62, 1.05, 1.96, 1.00, 0.32, False),
        (4.70, 1.02, 1.90, 0.97, 0.36, False)]),
}


def _interp(keys, s):
    """Profile at s: (beltline, roof, half-width share, sill) and the keyframe interval."""
    for k in range(len(keys) - 1):
        a, b = keys[k], keys[k + 1]
        if s <= b[0] + 1e-9:
            t = (s - a[0]) / max(b[0] - a[0], 1e-9)
            ra, rb = (a[2] or a[1] + 0.045), (b[2] or b[1] + 0.045)
            lerp = lambda u, v: u + (v - u) * t
            return lerp(a[1], b[1]), lerp(ra, rb), lerp(a[3], b[3]), lerp(a[4], b[4]), k
    a = keys[-1]
    return a[1], a[2] or a[1] + 0.045, a[3], a[4], len(keys) - 2


def _ring(hw, zt, zr, zb, glass):
    """Cross-section, counter-clockwise seen from the nose (right side first)."""
    r1 = zb + min(0.12, (zt - 0.06 - zb) * 0.4)
    if glass:
        right = [(hw - 0.05, zb), (hw, r1), (hw, zt - 0.06), (hw - 0.05, zt),
                 (hw - 0.09, zt + 0.03), (hw - 0.24, zr - 0.04)]
    else:
        right = [(hw - 0.05, zb), (hw, r1), (hw, zt - 0.06), (hw - 0.05, zt),
                 (hw - 0.12, zr - 0.025), (hw - 0.32, zr - 0.01)]
    left = [(-x, z) for x, z in reversed(right)]
    return right + [(0.0, zr)] + left


def _outward(mb, pts, center, mat, s):
    """Add a face, flipping its winding to point away from `center`."""
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = pts[0], pts[1], pts[-1]
    n = ((by - ay) * (cz - az) - (bz - az) * (cy - ay),
         (bz - az) * (cx - ax) - (bx - ax) * (cz - az),
         (bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
    m = [sum(p[i] for p in pts) / len(pts) - center[i] for i in range(3)]
    if n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0:
        pts = pts[::-1]
    mb.quad(pts, mat, surf=s, uvf=plan_uv)


def generate(ctx):
    shape = SHAPES[ctx.p("shape", "sedan")]
    L, W = ctx.p("length", shape["length"]), ctx.p("width", 1.8)
    k_len = L / shape["length"]
    keys = [(s * k_len, *rest) for s, *rest in shape["keys"]]
    tint = ctx.p("tint", 0.5)
    mb = MeshBuilder(ctx.name)
    paint = surf(ctx, "metal", 0.25, tint)
    # The shader paints by tint (P_PAINT in src/materials/facade.ts); the preview matches it.
    paint = (paint[0], (paint[1][0], ctx.color(PAINTS[min(int(tint * 4), 3)])))
    glass = surf(ctx, "metal", 0.5, tint)
    rubber = surf(ctx, "metal", 0.75, tint)
    chrome = surf(ctx, "metal", 0.0, tint)
    wheel_r, wheel_w = ctx.p("wheel_radius", 0.31), ctx.p("wheel_width", 0.2)
    arch_r = wheel_r + ctx.p("arch_clearance", 0.06)
    axles = [s * k_len for s in ctx.p("axles", list(shape["axles"]))]

    # Stations: the keyframes plus a half circle of sill heights over each axle.
    stations = {round(k[0], 4) for k in keys}
    for a in axles:
        for f in (-1.0, -0.8, -0.45, 0.0, 0.45, 0.8, 1.0):
            stations.add(round(a + f * arch_r, 4))
    stations = sorted(stations)
    rings = []
    for s in stations:
        zt, zr, share, zb, k = _interp(keys, s)
        for a in axles:
            d = abs(s - a)
            if d < arch_r - 1e-6:
                zb = max(zb, wheel_r + sqrt(arch_r * arch_r - d * d))
        rings.append((s, _ring(W / 2 * share, zt, zr, zb, zr > zt + 0.1)))

    n = len(rings[0][1])
    side_band = (4, n - 6)            # edges r4→r5, mirrored: side glass
    top_band = (5, 6)                 # r5→crown→r5: roof / windscreen / rear glass
    for (s0, ring0), (s1, ring1) in zip(rings, rings[1:]):
        # The keyframe interval holding the segment decides what its glass faces are.
        k = _interp(keys, (s0 + s1) / 2)[4]
        a, b = keys[k], keys[k + 1]
        kind = "cabin" if a[2] and b[2] else "windscreen" if b[2] else "rear" if a[2] else "body"
        side_glass = kind == "cabin" and a[5]
        y0, y1 = s0 - L / 2, s1 - L / 2
        zc = (ring0[6][1] + ring0[0][1]) / 2
        center = (0.0, (y0 + y1) / 2, zc)
        for j in range(n):
            p, q = ring0[j], ring0[(j + 1) % n]
            pn, qn = ring1[j], ring1[(j + 1) % n]
            if j == n - 1 or j in (0, n - 2):
                s = rubber                # underbody, sills and arch liners
            elif j in side_band and side_glass:
                s = glass
            elif j in top_band and kind in ("windscreen", "rear"):
                s = glass
            else:
                s = paint
            _outward(mb, [(p[0], y0, p[1]), (q[0], y0, q[1]), (qn[0], y1, qn[1]), (pn[0], y1, pn[1])],
                     center, s[0], s[1])
    # Nose and tail caps.
    for y, ring, out in ((-L / 2, rings[0][1], -1.0), (L / 2, rings[-1][1], 1.0)):
        _outward(mb, [(x, y, z) for x, z in ring], (0.0, y - out, (ring[6][1] + ring[0][1]) / 2), paint[0], paint[1])

    _wheels(ctx, mb, W, axles, L, wheel_r, wheel_w, rubber, chrome)
    _details(ctx, mb, keys, rings, L, W, paint, glass, rubber, chrome)

    sign_h = 0.0
    if ctx.p("roof_sign", False):
        # Roof lantern over the middle of the roof.
        sign_h = ctx.p("taxi_sign_height", 0.16)
        cabin = [k for k in keys if k[2]]
        ym = (cabin[0][0] + cabin[-1][0]) / 2 - L / 2
        zr = max(k[2] for k in cabin)
        sm, ss = fixture(ctx, "sodium", strip=True)
        mb.box(-0.22, 0.22, ym - 0.08, ym + 0.08, zr - 0.01, zr + sign_h, sm, skip=("bottom",), surf=ss, uvf=plan_uv)
    mb.finish()
    roof = max(k[2] or 0.0 for k in keys)
    ctx.meta.update(footprint=[W, L + 0.1], height=roof + sign_h, shader="facade", family="vehicle")


def _wheels(ctx, mb, W, axles, L, r, w, rubber, chrome):
    n = ctx.p("wheel_segments", 10)
    for a in axles:
        y = a - L / 2
        for side in (-1, 1):
            x1 = side * (W / 2 - 0.03)
            x0 = x1 - side * w
            ring = [(y + r * cos(tau * i / n), r + r * sin(tau * i / n)) for i in range(n)]
            rim = [(y + r * 0.62 * cos(tau * i / n), r + r * 0.62 * sin(tau * i / n)) for i in range(n)]
            c = (x1 - side * w / 2, y, r)
            for i in range(n):
                a0, a1 = ring[i], ring[(i + 1) % n]
                _outward(mb, [(x0, *a0), (x1, *a0), (x1, *a1), (x0, *a1)], c, rubber[0], rubber[1])
                # Sidewall: tyre ring down to the rim, the rim a little recessed.
                b0, b1 = rim[i], rim[(i + 1) % n]
                xr = x1 - side * 0.03
                _outward(mb, [(x1, *a0), (x1, *a1), (xr, *b1), (xr, *b0)], (c[0] - side, y, r), rubber[0], rubber[1])
            _outward(mb, [(x1 - side * 0.03, *b) for b in rim], (c[0] - side, y, r), chrome[0], chrome[1])


def _details(ctx, mb, keys, rings, L, W, paint, glass, rubber, chrome):
    hm, hs = fixture(ctx, "white", strip=True)
    tm, ts = fixture(ctx, "red", strip=True)
    yf, yr = -L / 2, L / 2
    hwf, hwr = W / 2 * keys[0][3], W / 2 * keys[-1][3]
    zf, zr_ = keys[0][1], keys[-1][1]
    eps = 0.006
    for side in (-1, 1):
        # Headlights high on the nose, tail lights wrapping the tail.
        x0, x1 = side * (hwf - 0.08), side * (hwf - 0.42)
        _flat_y(mb, x0, x1, zf - 0.16, zf - 0.04, yf - eps, -1, hm, hs)
        x0, x1 = side * (hwr - 0.06), side * (hwr - 0.48)
        _flat_y(mb, x0, x1, zr_ - 0.2, zr_ - 0.05, yr + eps, 1, tm, ts)
    # Grille, number plates and bumpers.
    _flat_y(mb, -(hwf - 0.48), hwf - 0.48, zf - 0.15, zf - 0.05, yf - eps, -1, rubber[0], rubber[1])
    _flat_y(mb, -0.2, 0.2, 0.31, 0.41, yf - 0.04, -1, chrome[0], chrome[1])
    _flat_y(mb, -0.2, 0.2, zr_ - 0.34, zr_ - 0.23, yr + eps, 1, chrome[0], chrome[1])
    bumper = rubber if ctx.p("black_bumpers", False) else paint
    for y0, y1 in ((yf - 0.035, yf + 0.18), (yr - 0.18, yr + 0.035)):
        mb.box(-(W / 2 - 0.09), W / 2 - 0.09, y0, y1, 0.3, 0.42, bumper[0], surf=bumper[1], uvf=plan_uv)
        mb.box(-(W / 2 - 0.1), W / 2 - 0.1, y0 + 0.02, y1 - 0.02, 0.24, 0.3, rubber[0], surf=rubber[1], uvf=plan_uv)
    # Van rear window in the tail.
    if keys[-1][2]:
        _flat_y(mb, -(hwr - 0.22), hwr - 0.22, keys[-1][1] + 0.12, keys[-1][2] - 0.2, yr + eps, 1, glass[0], glass[1])
    # Mirrors at the windscreen base, door seams and handles on the flat side band.
    ws = next(k for k in keys if k[2]) if any(k[2] for k in keys) else keys[2]
    base = keys[keys.index(ws) - 1]
    ym = base[0] - L / 2 + 0.25
    seams = [k[0] - L / 2 for k in keys if k[2] and not k[5]][:1]   # B-pillar
    doors = [base[0] - L / 2 + 0.1] + seams
    zt = base[1]
    for side in (-1, 1):
        x = side * W / 2
        # Mirror housings start inside the shoulder so they sit on the door, not beside it.
        mb.box(*sorted((x - side * 0.1, x + side * 0.1)), ym - 0.05, ym + 0.05, zt + 0.02, zt + 0.13,
               paint[0], surf=paint[1], uvf=plan_uv)
        for y in doors:
            _flat_x(mb, x + side * 0.003, y - 0.006, y + 0.006, 0.42, zt - 0.08, side, rubber[0], rubber[1])
            _flat_x(mb, x + side * 0.004, y + 0.55, y + 0.7, zt - 0.17, zt - 0.13, side, chrome[0], chrome[1])


def _flat_y(mb, x0, x1, z0, z1, y, out, mat, s):
    """Quad in the x-z plane at y, facing `out` (-1 = nose)."""
    x0, x1 = min(x0, x1), max(x0, x1)
    pts = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
    mb.quad(pts if out < 0 else pts[::-1], mat, surf=s, uvf=plan_uv)


def _flat_x(mb, x, y0, y1, z0, z1, out, mat, s):
    """Quad in the y-z plane at x, facing `out` (+1 = right)."""
    pts = [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)]
    mb.quad(pts if out > 0 else pts[::-1], mat, surf=s, uvf=plan_uv)
