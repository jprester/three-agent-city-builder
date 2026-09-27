"""Surface types for the runtime facade shader.

Every face of a facade-shaded asset carries, in the "Surface" color attribute (COLOR_0):
  r = (type code + 0.5) / 16   which shader branch (codes in art/style/facade.json)
  g = window faces (residential/office/curtain): opening pattern code, (code + 0.5) / 64,
                               see window_code(); podium: share of shop bays open;
                               fixture: color; screen: seed
  b = tint                     0..1 picks the base color within the type's palette range

UVs (TEXCOORD_0) are facade coordinates in meters: u along the facade from its left edge
(seen from outside), v up from the facade's cell origin (`vbase`). glTF flips v; the
shader undoes it.

Blender materials here only color the previews (by type); the runtime ignores them."""
from lib.materials import material

# Preview colors per type (palette names). Workbench previews show them via the "Preview"
# color attribute; it is removed before export.
_PREVIEW = {
    "residential": "concrete",
    "office": "concrete_dark",
    "curtain": "glass_dark",
    "podium": "tungsten",
    "roof": "concrete_dark",
    "trim": "tile_stained",
    "metal": "metal_dark",
    "cage": "sign_amber",
    "soffit": "fluorescent",
    "fixture": "sodium",
    "atlas": "glass_dark",
    "screen": "sign_cyan",
}

ATTRIBUTE = "Surface"
PREVIEW_ATTRIBUTE = "Preview"


WINDOW_KINDS = ("residential", "office", "curtain")

# Opening pattern codes (must match openCol() in src/materials/facade.ts). Openings are
# whole cell columns, identical on every floor: structure is ordered, life inside varies.
CODE_BLANK, CODE_GRID, CODE_EVEN, CODE_ODD = 0, 63, 62, 61
MASK_COLUMNS = 6   # bit masks address columns 0..5; wider patterns use grid/even/odd


def window_code(pattern, cols):
    """Opening pattern for a window face `cols` cells wide. `pattern` is a name:
      grid       every column (exposed facades)
      blank      no openings (party walls)
      alternate  every other column
      stair      one column in the middle (stairwell / bathroom stack)
      stair2     two columns, one bay in from each end
      ends       the two end columns (corner rooms)
    or a legacy number (old fill share): >= 0.75 grid, >= 0.35 alternate, > 0 stair, else blank.
    Returns the integer code 0..63."""
    if not isinstance(pattern, str):
        f = float(pattern)
        pattern = "grid" if f >= 0.75 else "alternate" if f >= 0.35 else "stair" if f > 0 else "blank"
    cols = max(1, int(round(cols)))
    if pattern == "grid":
        return CODE_GRID
    if pattern == "blank":
        return CODE_BLANK
    if pattern == "alternate":
        return CODE_EVEN if cols % 2 else CODE_ODD   # odd widths: symmetric with both ends open
    picks = {
        "stair": [cols // 2],
        "stair2": [1, cols - 2] if cols >= 4 else [cols // 2],
        "ends": [0, cols - 1] if cols >= 2 else [0],
    }.get(pattern)
    if picks is None:
        raise ValueError(f"unknown window pattern {pattern!r}")
    if max(picks) >= MASK_COLUMNS:
        # Too wide for a column mask: an ordered alternate pattern instead of a lopsided one.
        return CODE_EVEN if cols % 2 else CODE_ODD
    mask = 0
    for c in picks:
        mask |= 1 << c
    return min(mask, CODE_ODD - 1) or CODE_BLANK


def surf(ctx, kind, fill=1.0, tint=0.0, cols=None):
    """(material, (surface color, preview color)) for a face of type `kind`.

    For window kinds `fill` is an opening pattern (see window_code; `cols` = face width in
    cells, needed by column patterns); for other kinds it is the type's own parameter.

    Every facade-shaded face uses the same material: Blender 5.2's glTF exporter writes the
    color attribute correctly only for a mesh's first material and exports the others white,
    so a facade mesh must be a single primitive anyway."""
    code = ctx.facade["types"][kind]
    mat = material(ctx, "M_facade", "concrete", roughness=0.8)
    if kind in WINDOW_KINDS:
        g = (window_code(fill, cols or 1) + 0.5) / 64.0
    else:
        g = float(fill)
    return mat, (((code + 0.5) / 16.0, g, float(tint)), ctx.color(_PREVIEW[kind]))


def cols_of(ctx, kind, width):
    """Face width in whole window cells of `kind` (1 for non-window kinds)."""
    cell = ctx.facade["cells"].get(kind)
    return max(1, int(round(width / cell["w"]))) if cell else 1


def facade_uv(fw, vbase):
    """UVs for faces built in a facade-local frame (lib.transforms.facade_xf): the wall
    plane is y' = 0 with the outside at y' < 0, u runs -fw/2..fw/2 along it."""
    def uvf(pts, n):
        ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
        if ay >= ax and ay >= az:      # parallel to the wall: same cells as the wall
            return [(x + fw / 2, z - vbase) for x, y, z in pts]
        if ax >= az:                   # side of a protrusion: u = distance out from the wall
            return [(-y, z - vbase) for x, y, z in pts]
        return [(x + fw / 2, -y) for x, y, z in pts]   # top/bottom of a protrusion
    return uvf


def plan_uv(pts, n):
    """Roofs and other horizontal faces built in building space: world-aligned meters.
    Vertical faces use their horizontal extent as u."""
    if abs(n[2]) >= max(abs(n[0]), abs(n[1])):
        return [(x, y) for x, y, z in pts]
    if abs(n[0]) >= abs(n[1]):
        return [(y, z) for x, y, z in pts]
    return [(x, z) for x, y, z in pts]


def fixture(ctx, color, strip=False):
    """(material, surface) for a light fixture of a named color (facade.json fixture_colors).
    strip=True marks long LED strips (tint 1), which the shader lights softly; point fixtures
    (lamps, aviation lights) burn hot."""
    return surf(ctx, "fixture", ctx.facade["fixture_colors"][color], 1.0 if strip else 0.0)
