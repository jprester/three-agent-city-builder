"""Headless entry point: build one asset from its def, export GLB, render previews.

Invoked by tools/build-assets.mjs, roughly:
  blender --background --factory-startup --python-exit-code 1 \
      --python tools/blender/run.py -- \
      --def art/defs/buildings/tower_a.json --id buildings/tower_a \
      --out build/raw/buildings/tower_a.glb \
      [--previews build/previews/buildings/tower_a --preview-engine workbench --preview-res 768]
"""
import argparse
import importlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "art" / "generators"))
sys.path.insert(0, str(HERE))

from lib.context import GenContext  # noqa: E402
from lib.scene import reset_scene, strip_preview_data, triangle_count  # noqa: E402
import export_glb  # noqa: E402
import previews  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--def", dest="def_path", required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--previews", default=None)
    p.add_argument("--preview-engine", default="workbench")
    p.add_argument("--preview-res", type=int, default=768)
    return p.parse_args(argv)


def main():
    args = parse_args()
    spec = json.loads(Path(args.def_path).read_text())
    palette = json.loads((ROOT / "art" / "style" / "palette.json").read_text())
    facade = json.loads((ROOT / "art" / "style" / "facade.json").read_text())

    reset_scene()
    module = importlib.import_module(spec["generator"].replace("/", "."))
    ctx = GenContext(args.id, spec.get("params", {}), spec.get("seed", 0), palette, facade)
    module.generate(ctx)

    tris = triangle_count()
    # Previews first: they may show preview-only data that is stripped before export.
    if args.previews:
        previews.render(Path(args.previews), engine=args.preview_engine, resolution=args.preview_res)
    strip_preview_data()
    export_glb.export(Path(args.out))

    # Single machine-readable line for the orchestrator.
    print("ASSET_RESULT " + json.dumps({"id": args.id, "triangles": tris, "meta": ctx.meta}))


main()
