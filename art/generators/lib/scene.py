"""Scene utilities used by tools/blender/run.py."""
import bpy


def reset_scene():
    """Remove all data so each asset builds from nothing (deterministic, no leftovers)."""
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
                 bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


def triangle_count() -> int:
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            total += sum(len(p.vertices) - 2 for p in obj.data.polygons)
    return total


def strip_preview_data():
    """Remove preview-only color attributes (lib.surface.PREVIEW_ATTRIBUTE) before export."""
    for mesh in bpy.data.meshes:
        attr = mesh.color_attributes.get("Preview")
        if attr is not None:
            mesh.color_attributes.remove(attr)
