"""GLB export with fixed settings. Change settings here, never per asset."""
from pathlib import Path

import bpy


def export(out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        # Vertex data consumed by runtime shaders (not by glTF materials) must survive export:
        # the active color attribute becomes COLOR_0, custom "_name" attributes are kept.
        export_vertex_color="ACTIVE",
        export_attributes=True,
    )
