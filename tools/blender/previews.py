"""Fixed-camera preview renders for review by agents and humans.

Workbench is the default: fast, no GPU needed, shows material colors flat so
shape and color distribution are easy to judge. Use engine='eevee' for a lit
look (needs a GPU context; works on macOS)."""
import math
from pathlib import Path

import bpy
from mathutils import Vector

# (name, azimuth degrees from -Y toward +X, elevation degrees)
VIEWS = [("front34", 35, 18), ("back34", 215, 18), ("top", 0, 88)]


def _bounds():
    pts = []
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            pts += [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    if not pts:
        return Vector((0, 0, 0)), 1.0
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (lo + hi) / 2, max((hi - lo).length / 2, 0.01)


def _engine_id(engine: str) -> str:
    available = {i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    if engine == "eevee":
        for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            if candidate in available:
                return candidate
    return "BLENDER_WORKBENCH"


def render(out_dir: Path, engine="workbench", resolution=768):
    out_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = _engine_id(engine)
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.image_settings.file_format = "PNG"
    if scene.render.engine == "BLENDER_WORKBENCH":
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_cavity = True

    if scene.world is None:
        scene.world = bpy.data.worlds.new("PreviewWorld")
    scene.world.color = (0.02, 0.025, 0.035)

    center, radius = _bounds()
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    fov = cam_data.angle
    dist = radius / math.sin(fov / 2) * 1.1
    cam_data.clip_end = dist * 4

    for name, az, el in VIEWS:
        a, e = math.radians(az), math.radians(el)
        offset = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
        cam.location = center + offset
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(out_dir / f"{name}.png")
        bpy.ops.render.render(write_still=True)

    bpy.data.objects.remove(cam)
