"""Surface types for the runtime facade shader.

Every face of a facade-shaded asset carries, in the "Surface" color attribute (COLOR_0):
  r = (type code + 0.5) / 16   which shader branch (codes in art/style/facade.json)
  g = fill                     residential/office/curtain/podium: share of cells with a window;
                               other types: free parameter (unused so far)
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
}

ATTRIBUTE = "Surface"
PREVIEW_ATTRIBUTE = "Preview"


def surf(ctx, kind, fill=1.0, tint=0.0):
    """(material, (surface color, preview color)) for a face of type `kind`.

    Every facade-shaded face uses the same material: Blender 5.2's glTF exporter writes the
    color attribute correctly only for a mesh's first material and exports the others white,
    so a facade mesh must be a single primitive anyway."""
    code = ctx.facade["types"][kind]
    mat = material(ctx, "M_facade", "concrete", roughness=0.8)
    return mat, (((code + 0.5) / 16.0, float(fill), float(tint)), ctx.color(_PREVIEW[kind]))


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
