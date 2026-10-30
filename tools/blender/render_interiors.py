"""Headless: render the room cards of art/interiors/interiors.json to build/interiors/*.png.

Invoked by tools/build-interiors.mjs:
  blender --background --factory-startup --python-exit-code 1 \
      --python tools/blender/render_interiors.py -- --def art/interiors/interiors.json --out build/interiors

Each card is one room (art/generators/interiors/rooms.py) seen by a pinhole camera `camera`
meters in front of the room's open front, centred on it, its frame exactly the W x H front
opening. The facade shader projects box hits through the same camera (src/materials/facade.ts
interior()), so the image and the ray-cast box line up.
"""
import argparse
import importlib
import json
import math
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "art" / "generators"))

from lib.context import GenContext  # noqa: E402
from lib.scene import reset_scene  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--def", dest="def_path", required=True)
    p.add_argument("--out", required=True)
    return p.parse_args(argv)


def setup_render(scene, cfg, res):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = cfg.get("samples", 64)
    scene.cycles.use_denoising = True
    scene.cycles.seed = 0
    # One diffuse bounce: darker corners and furniture shadows read through a small window.
    scene.cycles.diffuse_bounces = cfg.get("diffuse_bounces", 1)
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = cfg.get("exposure", 0.0)
    world = bpy.data.worlds.new("World")
    world.color = (0.0, 0.0, 0.0)
    scene.world = world


def add_camera(scene, W, H, f):
    data = bpy.data.cameras.new("Card")
    data.sensor_fit = "HORIZONTAL"
    data.sensor_width = 36.0
    data.lens = f * 36.0 / W       # horizontal field = the room's front width at distance f
    data.clip_start = 0.02
    obj = bpy.data.objects.new("Card", data)
    obj.location = (W / 2, -f, H / 2)
    obj.rotation_euler = (math.pi / 2, 0.0, 0.0)   # look along +Y, +Z up
    scene.collection.objects.link(obj)
    scene.camera = obj


def main():
    args = parse_args()
    spec = json.loads(Path(args.def_path).read_text())
    palette = json.loads((ROOT / "art" / "style" / "palette.json").read_text())
    module = importlib.import_module(spec["generator"].replace("/", "."))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for set_name, s in spec["sets"].items():
        W, H, D, f = s["width"], s["height"], s["depth"], s["camera"]
        for i, card in enumerate(s["cards"]):
            reset_scene()
            for w in list(bpy.data.worlds):
                bpy.data.worlds.remove(w)
            scene = bpy.context.scene
            params = {**spec.get("params", {}), **s.get("params", {}), **card.get("params", {}),
                      "kind": card["kind"], "width": W, "height": H, "depth": D}
            ctx = GenContext(f"interiors/{set_name}_{i:02d}", params, card["seed"], palette)
            module.generate(ctx)
            setup_render(scene, spec.get("render", {}), s["tile"])
            add_camera(scene, W, H, f)
            scene.render.filepath = str(out / f"{set_name}_{i:02d}.png")
            bpy.ops.render.render(write_still=True)
            print(f"INTERIOR_CARD {set_name} {i} {card['kind']}")


main()
