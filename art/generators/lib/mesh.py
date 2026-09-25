"""MeshBuilder: accumulate boxes and quads into one bmesh with material slots.

`xf` arguments are optional callables (x, y, z) -> (x, y, z). They must be proper
rotations/translations (no mirroring), otherwise face winding flips."""
import bmesh
import bpy


class MeshBuilder:
    def __init__(self, name: str):
        self.name = name
        self.bm = bmesh.new()
        self.materials = []
        self._slots = {}

    def _slot(self, mat) -> int:
        if mat.name not in self._slots:
            self._slots[mat.name] = len(self.materials)
            self.materials.append(mat)
        return self._slots[mat.name]

    def _verts(self, points, xf):
        return [self.bm.verts.new(xf(*p) if xf else p) for p in points]

    def quad(self, corners, mat, xf=None):
        """Four corners, counter-clockwise when viewed from the side the face points to."""
        f = self.bm.faces.new(self._verts(corners, xf))
        f.material_index = self._slot(mat)
        return f

    def box(self, x0, x1, y0, y1, z0, z1, mat, xf=None, skip=()):
        """Axis-aligned box in local space. `skip` omits faces by name:
        'bottom', 'top', 'front' (-y), 'right' (+x), 'back' (+y), 'left' (-x)."""
        v = self._verts(
            [
                (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
            ],
            xf,
        )
        faces = {
            "bottom": (0, 3, 2, 1),
            "top": (4, 5, 6, 7),
            "front": (0, 1, 5, 4),
            "right": (1, 2, 6, 5),
            "back": (2, 3, 7, 6),
            "left": (3, 0, 4, 7),
        }
        slot = self._slot(mat)
        for name, idx in faces.items():
            if name in skip:
                continue
            f = self.bm.faces.new([v[i] for i in idx])
            f.material_index = slot

    def finish(self):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.normal_update()
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.materials:
            mesh.materials.append(m)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj
