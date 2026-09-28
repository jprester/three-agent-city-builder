"""MeshBuilder: accumulate boxes and quads into one bmesh with material slots.

`xf` arguments are optional callables (x, y, z) -> (x, y, z). They must be proper
rotations/translations (no mirroring), otherwise face winding flips.

Faces can carry runtime-shader data (see lib/surface.py):
  surf  (r, g, b) written to the "Surface" color attribute (exported as COLOR_0), or a pair
        ((r, g, b), preview rgb) that also fills the "Preview" attribute used by previews
  uvf   callable(local_corners, local_normal) -> [(u, v), ...] written to the UV map
        (exported as TEXCOORD_0). It sees coordinates *before* `xf`, so facade-local
        frames give facade-local UVs."""
import bmesh
import bpy


def _normal(pts):
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = pts[0], pts[1], pts[2]
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    return (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)


class MeshBuilder:
    def __init__(self, name: str):
        self.name = name
        self.bm = bmesh.new()
        self.materials = []
        self._slots = {}
        self._uv = None
        self._col = None
        self._preview = None

    def _slot(self, mat) -> int:
        if mat.name not in self._slots:
            self._slots[mat.name] = len(self.materials)
            self.materials.append(mat)
        return self._slots[mat.name]

    def _verts(self, points, xf):
        return [self.bm.verts.new(xf(*p) if xf else p) for p in points]

    def _face(self, local_pts, xf, mat, surf=None, uvf=None):
        f = self.bm.faces.new(self._verts(local_pts, xf))
        f.material_index = self._slot(mat)
        if surf is not None or uvf is not None:
            if self._uv is None:
                self._uv = self.bm.loops.layers.uv.new("UVMap")
                self._col = self.bm.loops.layers.float_color.new("Surface")  # lib.surface.ATTRIBUTE
                self._preview = self.bm.loops.layers.float_color.new("Preview")  # lib.surface.PREVIEW_ATTRIBUTE
            uvs = uvf(local_pts, _normal(local_pts)) if uvf else [(0.0, 0.0)] * len(local_pts)
            data, preview = surf if surf and isinstance(surf[0], tuple) else (surf, None)
            color = (*(data or (0.0, 0.0, 0.0)), 1.0)
            pcolor = (*(preview or data or (0.5, 0.5, 0.5)), 1.0)
            for loop, uv in zip(f.loops, uvs):
                loop[self._uv].uv = uv
                loop[self._col] = color
                loop[self._preview] = pcolor
        return f

    def quad(self, corners, mat, xf=None, surf=None, uvf=None):
        """Four corners, counter-clockwise when viewed from the side the face points to."""
        return self._face(list(corners), xf, mat, surf, uvf)

    def box(self, x0, x1, y0, y1, z0, z1, mat, xf=None, skip=(), surf=None, uvf=None, faces=None):
        """Axis-aligned box in local space. `skip` omits faces by name:
        'bottom', 'top', 'front' (-y), 'right' (+x), 'back' (+y), 'left' (-x).
        `faces` maps a face name to (mat, surf) overriding the defaults for that face."""
        p = [
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
        ]
        idx = {
            "bottom": (0, 3, 2, 1),
            "top": (4, 5, 6, 7),
            "front": (0, 1, 5, 4),
            "right": (1, 2, 6, 5),
            "back": (2, 3, 7, 6),
            "left": (3, 0, 4, 7),
        }
        for name, ids in idx.items():
            if name in skip:
                continue
            m, s = (faces or {}).get(name, (mat, surf))
            self._face([p[i] for i in ids], xf, m, s, uvf)

    def discard(self):
        """Drop everything built so far (a sink for detail that a coarse LOD leaves out while
        still consuming its random draws)."""
        self.bm.free()

    def finish(self):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.normal_update()
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.materials:
            mesh.materials.append(m)
        if "Surface" in mesh.color_attributes:
            # Exported: the render color (COLOR_0). Displayed in previews: the active color.
            names = [a.name for a in mesh.color_attributes]
            mesh.color_attributes.render_color_index = names.index("Surface")
            mesh.color_attributes.active_color = mesh.color_attributes["Preview"]
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj
