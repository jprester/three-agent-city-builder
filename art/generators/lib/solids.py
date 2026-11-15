"""Solids beyond axis-aligned boxes for MeshBuilder: prisms, lofts and rotated boxes, plus a
route frame for linear structures (the monorail).

Route frame: u along the structure, v across it (+v is three.js +Z at rotationY = 0, i.e.
Blender -Y), y up. Blender coordinates are (x, y, z) = (u, -v, y).

Profiles are lists of (a, b) points counter-clockwise in their plane:
  prism_x / loft_x: (Blender y, Blender z), seen from +x
  prism_z:          (Blender x, Blender y), seen from +z
Faces then point outward. Each face gets one surface (mat, surf) pair or a callable
`pick(i)` returning the pair for side i (edge i -> i + 1 of the profile)."""
from math import cos, sin

from lib.surface import plan_uv


def _pair(s, i):
    return s(i) if callable(s) else s


def prism_x(mb, profile, x0, x1, s, caps=(True, True), closed=True):
    """Extrude a (y, z) profile along x from x0 to x1."""
    n = len(profile)
    for i in range(n if closed else n - 1):
        (ya, za), (yb, zb) = profile[i], profile[(i + 1) % n]
        m, f = _pair(s, i)
        mb.quad([(x0, ya, za), (x0, yb, zb), (x1, yb, zb), (x1, ya, za)], m, None, f, plan_uv)
    m, f = _pair(s, -1)
    if caps[1]:
        mb.quad([(x1, y, z) for y, z in profile], m, None, f, plan_uv)
    if caps[0]:
        mb.quad([(x0, y, z) for y, z in reversed(profile)], m, None, f, plan_uv)


def prism_z(mb, profile, z0, z1, s, caps=(False, True)):
    """Extrude an (x, y) profile up from z0 to z1 (columns, legs)."""
    n = len(profile)
    for i in range(n):
        (xa, ya), (xb, yb) = profile[i], profile[(i + 1) % n]
        m, f = _pair(s, i)
        mb.quad([(xa, ya, z0), (xb, yb, z0), (xb, yb, z1), (xa, ya, z1)], m, None, f, plan_uv)
    m, f = _pair(s, -1)
    if caps[1]:
        mb.quad([(x, y, z1) for x, y in profile], m, None, f, plan_uv)
    if caps[0]:
        mb.quad([(x, y, z0) for x, y in reversed(profile)], m, None, f, plan_uv)


def polygon(cx, cy, r, sides, rx=None, phase=None):
    """Regular polygon (x, y) points, counter-clockwise; `rx` stretches it along x."""
    from math import pi
    ph = pi / sides if phase is None else phase
    return [(cx + (rx or r) * cos(ph + 2 * pi * k / sides), cy + r * sin(ph + 2 * pi * k / sides)) for k in range(sides)]


def loft_x(mb, stations, s, closed=True):
    """Skin between (x, profile) stations, x increasing; every profile has the same point count.
    `s` may be a callable pick(i, k) for side i between stations k and k + 1."""
    for k in range(len(stations) - 1):
        (xa, pa), (xb, pb) = stations[k], stations[k + 1]
        n = len(pa)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            m, f = s(i, k) if callable(s) else s
            mb.quad([(xa, *pa[i]), (xa, *pa[j]), (xb, *pb[j]), (xb, *pb[i])], m, None, f, plan_uv)


def rotated_box(mb, center, size, axis, angle, s, skip=()):
    """Box of `size` (x, y, z) centred on `center`, turned by `angle` about the Blender `axis`
    ('x', 'y' or 'z') through its centre."""
    cx, cy, cz = center
    c, sn = cos(angle), sin(angle)

    def xf(x, y, z):
        if axis == "x":
            y, z = y * c - z * sn, y * sn + z * c
        elif axis == "y":
            x, z = x * c + z * sn, -x * sn + z * c
        else:
            x, y = x * c - y * sn, x * sn + y * c
        return (x + cx, y + cy, z + cz)

    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    m, f = s
    mb.box(-hx, hx, -hy, hy, -hz, hz, m, xf, skip, f, plan_uv)


def strut(mb, a, b, w, h, s):
    """A bar of section w (across) x h from Blender point a to b, in a plane of constant y or
    constant x (raked links, braces, stringers)."""
    from math import atan2, hypot
    ax, ay, az = a
    bx, by, bz = b
    cx, cy, cz = (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2
    if abs(by - ay) < 1e-6:      # in an x-z plane: rotate about y
        L = hypot(bx - ax, bz - az)
        rotated_box(mb, (cx, cy, cz), (L, w, h), "y", -atan2(bz - az, bx - ax), s)
    else:                        # in a y-z plane: rotate about x
        L = hypot(by - ay, bz - az)
        rotated_box(mb, (cx, cy, cz), (w, L, h), "x", atan2(bz - az, by - ay), s)


class Route:
    """Boxes and quads in the route frame (u along, v across, y up)."""
    SKIP = {"u+": "right", "u-": "left", "v+": "front", "v-": "back", "top": "top", "bottom": "bottom"}

    def __init__(self, mb):
        self.mb = mb

    def box(self, u0, u1, v0, v1, y0, y1, s, skip=(), faces=None):
        m, f = s
        fm = {self.SKIP[k]: v for k, v in (faces or {}).items()}
        self.mb.box(min(u0, u1), max(u0, u1), -max(v0, v1), -min(v0, v1), min(y0, y1), max(y0, y1), m, None,
                    tuple(self.SKIP[k] for k in skip), f, plan_uv, faces=fm)

    def up(self, u0, u1, v0, v1, y, s):
        """Upward-facing quad at height y."""
        m, f = s
        a, b = min(u0, u1), max(u0, u1)
        c, d = -max(v0, v1), -min(v0, v1)
        self.mb.quad([(a, c, y), (b, c, y), (b, d, y), (a, d, y)], m, None, f, plan_uv)

    def down(self, u0, u1, v0, v1, y, s):
        """Downward-facing quad at height y."""
        m, f = s
        a, b = min(u0, u1), max(u0, u1)
        c, d = -max(v0, v1), -min(v0, v1)
        self.mb.quad([(a, d, y), (b, d, y), (b, c, y), (a, c, y)], m, None, f, plan_uv)

    def side(self, u0, u1, v, y0, y1, facing, s):
        """Vertical quad along u at v, facing +v (facing=1) or -v (facing=-1)."""
        m, f = s
        a, b = min(u0, u1), max(u0, u1)
        y = -v
        if facing > 0:   # Blender -y
            self.mb.quad([(a, y, y0), (b, y, y0), (b, y, y1), (a, y, y1)], m, None, f, plan_uv)
        else:
            self.mb.quad([(b, y, y0), (a, y, y0), (a, y, y1), (b, y, y1)], m, None, f, plan_uv)

    def end(self, u, v0, v1, y0, y1, facing, s):
        """Vertical quad across v at u, facing +u (facing=1) or -u."""
        m, f = s
        c, d = -max(v0, v1), -min(v0, v1)
        if facing > 0:
            self.mb.quad([(u, c, y0), (u, d, y0), (u, d, y1), (u, c, y1)], m, None, f, plan_uv)
        else:
            self.mb.quad([(u, d, y0), (u, c, y0), (u, c, y1), (u, d, y1)], m, None, f, plan_uv)

    def strut(self, a, b, w, h, s):
        """Bar between route-frame points a and b (u, v, y), in a plane of constant u or v."""
        strut(self.mb, (a[0], -a[1], a[2]), (b[0], -b[1], b[2]), w, h, s)

    def column(self, u, v, r, y0, y1, s, sides=8, caps=(False, True)):
        """Polygonal column (rounded read) at (u, v)."""
        prism_z(self.mb, polygon(u, -v, r, sides), y0, y1, s, caps)
