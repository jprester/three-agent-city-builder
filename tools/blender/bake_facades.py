"""Headless: model each tower facade style of a def and render its maps straight on.

Invoked by tools/build-facades.mjs:
  blender --background --factory-startup --python-exit-code 1 \
      --python tools/blender/bake_facades.py -- --def art/facades/baked.json --out build/facades

A facade is flat, so an orthographic render from the front IS its texture: no UV unwrap, no bake
setup. One Cycles render per map, every material reduced to an emission of the quantity wanted,
so there is no lighting in any of them:
  albedo   base color (glass 70 % opaque over the blinds and the dark room behind it)
  rough    roughness (data, written through the Standard view transform: decoded when packed)
  normal   world shading normal * 0.5 + 0.5, incl. the wall's brick / tile bump
  glass    1 on glass, 0 elsewhere
  blind    1 on blinds seen through clear glass
  ao       ambient occlusion (frames, reveals and sills shade the recess)
Out: <out>/<style id>/<map>.png at the def's cell size, plus <out>/<style id>/layout.json with the
exact grid (meters -> pixels) and each window's opening, for tools/textures/pack_facades.py.

The grid starts at a pier centre and a spandrel centre, so its edges lie on wall; brick and tile
sizes are chosen to divide the bay and the floor exactly, so the texture tiles on its grid.
Deterministic: the def's seed drives every random choice.
"""
import argparse
import json
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parents[2]
PALETTE = json.loads((ROOT / "art" / "style" / "palette.json").read_text())
PASSES = ("albedo", "rough", "normal", "glass", "blind", "ao")
RECESS = 0.25          # m: glass plane behind the wall's face
# Glass tints (multiplier on glass_facade, hue shift toward green or blue); one per window.
GLASS = ("glass_a", "glass_b", "glass_c", "glass_d", "glass_e", "glass_f")
GLASS_TINT = {"glass_a": (1.0, 1.0, 1.0), "glass_b": (1.3, 1.3, 1.25), "glass_c": (0.75, 0.75, 0.8),
              "glass_d": (0.9, 1.1, 1.0), "glass_e": (1.0, 1.05, 1.25), "glass_f": (1.6, 1.55, 1.5)}
FRAME = 0.06           # m: frame bar width
MULLION = 0.05


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def color(name, k=1.0):
    h = PALETTE[name].lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) * k for i in (0, 2, 4)) + (1.0,)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def box(bm, x0, x1, y0, y1, z0, z1):
    v = [bm.verts.new(p) for p in (
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])


def plane_y(bm, x0, x1, y, z0, z1):
    """A plane at depth y facing the camera (-Y)."""
    v = [bm.verts.new(p) for p in ((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1))]
    bm.faces.new(v)


def build(style, rng):
    """Geometry per material kind, plus the windows' openings (meters, grid coordinates)."""
    meshes = {k: bmesh.new() for k in ("wall", "frame", "sill", "blind", "blind_b", "curtain", "curtain_b", "ac", "grille",
                                       "interior", *GLASS)}
    floor, bay, pier, sp = style["floor"], style["bay"], style["pier"], style["spandrel"]
    bays, floors = style["_bays"], style["_floors"]
    windows = []
    for i in range(-2, floors + 2):
        for j in range(-2, bays + 2):
            x0, z0 = j * bay, i * floor
            x1, z1 = x0 + bay, z0 + floor
            ox0, ox1, oz0, oz1 = x0 + pier / 2, x1 - pier / 2, z0 + sp / 2, z1 - sp / 2
            w = meshes["wall"]
            box(w, x0, ox0, 0.0, 0.3, z0, z1)
            box(w, ox1, x1, 0.0, 0.3, z0, z1)
            box(w, ox0, ox1, 0.0, 0.3, z0, oz0)
            box(w, ox0, ox1, 0.0, 0.3, oz1, z1)
            # Frame round the opening, mullions, a transom under the top light.
            f = meshes["frame"]
            for (a, b, c, d) in ((ox0, ox1, oz0, oz0 + FRAME), (ox0, ox1, oz1 - FRAME, oz1),
                                 (ox0, ox0 + FRAME, oz0, oz1), (ox1 - FRAME, ox1, oz0, oz1)):
                box(f, a, b, RECESS - 0.1, RECESS + 0.02, c, d)
            panes = style["panes"]
            for k in range(1, panes):
                x = ox0 + (ox1 - ox0) * k / panes
                box(f, x - MULLION / 2, x + MULLION / 2, RECESS - 0.08, RECESS + 0.02, oz0, oz1)
            if style["transom"] > 0:
                z = oz1 - style["transom"]
                box(f, ox0, ox1, RECESS - 0.08, RECESS + 0.02, z - MULLION / 2, z + MULLION / 2)
            plane_y(meshes[rng.choice(GLASS)], ox0, ox1, RECESS, oz0, oz1)
            box(meshes["sill"], ox0 - 0.04, ox1 + 0.04, -0.07, RECESS - 0.1, oz0 - 0.06, oz0 + 0.01)
            blind = 0.0
            r = rng.random()
            if r < style["blinds"]:
                # Venetian blinds at some height, or curtains drawn from one side.
                if rng.random() < 0.7:
                    blind = rng.uniform(0.25, 0.95)
                    plane_y(meshes[rng.choice(("blind", "blind", "blind_b"))], ox0 + 0.02, ox1 - 0.02, RECESS + 0.08,
                            oz1 - blind * (oz1 - oz0), oz1 - 0.02)
                else:
                    blind = 1.0
                    share = rng.uniform(0.25, 0.6) * (ox1 - ox0)
                    a, b = (ox0, ox0 + share) if rng.random() < 0.5 else (ox1 - share, ox1)
                    plane_y(meshes[rng.choice(("curtain", "curtain_b"))], a + 0.02, b - 0.02, RECESS + 0.1, oz0 + 0.02, oz1 - 0.02)
            if rng.random() < style.get("ac", 0.0):
                # Air-conditioning unit on the sill, its grille facing out.
                aw = 0.78
                ax = rng.uniform(ox0 + 0.1, max(ox0 + 0.1, ox1 - aw - 0.1))
                box(meshes["ac"], ax, ax + aw, -0.42, -0.02, oz0 + 0.01, oz0 + 0.55)
                box(meshes["grille"], ax + 0.06, ax + aw - 0.24, -0.43, -0.41, oz0 + 0.07, oz0 + 0.49)
            if rng.random() < style.get("balconies", 0.0):
                # Balcony: a slab under the window and a bar railing in front of its lower part.
                box(meshes["sill"], ox0 - 0.15, ox1 + 0.15, -1.25, 0.0, oz0 - 0.18, oz0)
                for k in range(int((ox1 - ox0 + 0.3) / 0.13) + 1):
                    x = ox0 - 0.15 + k * 0.13
                    box(meshes["frame"], x, x + 0.025, -1.22, -1.19, oz0, oz0 + 1.0)
                box(meshes["frame"], ox0 - 0.15, ox1 + 0.15, -1.24, -1.18, oz0 + 0.98, oz0 + 1.05)
            if style.get("fins", 0.0) > 0:
                # Vertical fin on the pier's centre line (the grid line), standing out of the wall.
                box(meshes["frame"], x0 - 0.05, x0 + 0.05, -style["fins"], 0.0, z0, z1)
            if 0 <= i < floors and 0 <= j < bays:
                windows.append({"floor": i, "bay": j, "x": [ox0, ox1], "z": [oz0, oz1], "blind": blind})
    plane_y(meshes["interior"], -3 * bay, (bays + 3) * bay, RECESS + 3.0, -3 * floor, (floors + 3) * floor)
    return meshes, windows


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def wall_nodes(nt, style):
    """(color socket, bump normal socket, roughness) for the wall: brick, tile or concrete joints."""
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    xz = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(sep.outputs["X"], xz.inputs["X"])
    nt.links.new(sep.outputs["Z"], xz.inputs["Y"])
    c1, c2, mortar = (color(n) for n in style["colors"])
    floor, bay = style["floor"], style["bay"]
    tex = nt.nodes.new("ShaderNodeTexBrick")
    kind = style["wall"]
    if kind == "brick":
        length = bay / round(bay / 0.24)
        course = floor / (2 * round(floor / 0.15))
        tex.offset, tex.offset_frequency = 0.5, 2
        mortar_size, rough, strength = 0.008, 0.85, 0.5
    elif kind == "tile":
        length = bay / round(bay / 0.11)
        course = floor / round(floor / 0.11)
        tex.offset = 0.0
        mortar_size, rough, strength = 0.004, 0.45, 0.35
    elif kind == "panel":  # curtain wall: spandrel glass panels between aluminium caps
        length, course = bay, floor / 2
        tex.offset = 0.0
        mortar_size, rough, strength = 0.03, 0.15, 0.2
    else:  # concrete: formwork panels, a joint every floor and every half bay
        length, course = bay / 2, floor
        tex.offset = 0.0
        mortar_size, rough, strength = 0.012, 0.8, 0.3
    tex.inputs["Color1"].default_value = c1
    tex.inputs["Color2"].default_value = c2
    tex.inputs["Mortar"].default_value = mortar
    tex.inputs["Scale"].default_value = 1.0
    tex.inputs["Mortar Size"].default_value = mortar_size
    tex.inputs["Brick Width"].default_value = length
    tex.inputs["Row Height"].default_value = course
    tex.inputs["Bias"].default_value = 0.0
    nt.links.new(xz.outputs[0], tex.inputs["Vector"])
    bump = node(nt, "ShaderNodeBump", Strength=strength, Distance=0.01)
    inv = node(nt, "ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs["Fac"], inv.inputs[1])
    nt.links.new(inv.outputs[0], bump.inputs["Height"])
    return tex.outputs["Color"], bump.outputs["Normal"], rough


def material(name, kind, style, pass_name):
    """Emission-only material for one map. kind: wall, frame, glass*, sill, blind, interior."""
    mat = bpy.data.materials.new(f"{name}:{pass_name}")
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    shader = emit.outputs[0]
    flat = {"frame": (color(style["frame"]), 0.35), "sill": (color(style["sill"]), 0.75),
            "blind": (color("blind_beige"), 0.9), "blind_b": (color("blind_white"), 0.9),
            "curtain": (color("curtain_rose"), 0.95), "curtain_b": (color("curtain_grey"), 0.95),
            "ac": (color("ac_grey"), 0.6), "grille": (color("ac_grille"), 0.7),
            "interior": (color("interior_dark"), 0.95)}
    if kind == "wall":
        col, normal, rough = wall_nodes(nt, style)
    elif kind in GLASS_TINT:
        base, t = color("glass_facade"), GLASS_TINT[kind]
        col, normal, rough = (base[0] * t[0], base[1] * t[1], base[2] * t[2], 1.0), None, 0.05
    else:
        col, normal, rough = flat[kind][0], None, flat[kind][1]
    if normal is None:
        normal = nt.nodes.new("ShaderNodeNewGeometry").outputs["Normal"]
    is_glass = kind in GLASS_TINT
    is_blind = kind.startswith("blind") or kind.startswith("curtain")

    def value(v):
        emit.inputs["Color"].default_value = (v, v, v, 1.0)

    if pass_name == "albedo":
        if isinstance(col, tuple):
            emit.inputs["Color"].default_value = col
        else:
            nt.links.new(col, emit.inputs["Color"])
        if is_glass:
            # Partly clear: the blinds and the dark room behind read through, as in a photo.
            mix = node(nt, "ShaderNodeMixShader", Fac=0.7)
            clear = nt.nodes.new("ShaderNodeBsdfTransparent")
            nt.links.new(clear.outputs[0], mix.inputs[1])
            nt.links.new(emit.outputs[0], mix.inputs[2])
            shader = mix.outputs[0]
    elif pass_name == "rough":
        value(rough)
    elif pass_name == "normal":
        mad = nt.nodes.new("ShaderNodeVectorMath")
        mad.operation = "MULTIPLY_ADD"
        mad.inputs[1].default_value = (0.5, 0.5, 0.5)
        mad.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(normal, mad.inputs[0])
        nt.links.new(mad.outputs[0], emit.inputs["Color"])
    elif pass_name == "glass":
        value(1.0 if is_glass else 0.0)
    elif pass_name == "blind":
        if is_glass:
            shader = nt.nodes.new("ShaderNodeBsdfTransparent").outputs[0]
        value(1.0 if is_blind else 0.0)
    elif pass_name == "ao":
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        ao.inputs["Distance"].default_value = 0.6
        nt.links.new(normal, ao.inputs["Normal"])
        nt.links.new(ao.outputs["AO"], emit.inputs["Color"])
    nt.links.new(shader, out.inputs["Surface"])
    return mat


def render(style, cfg, out_dir):
    reset()
    rng = random.Random(style["seed"])
    ppm = cfg["pixels_per_meter"]
    cw, ch = cfg["cell"]
    # As many whole bays and floors as fit the cell; the grid is centred in it.
    style["_bays"] = max(1, int(cw // (style["bay"] * ppm)))
    style["_floors"] = max(1, int(ch // (style["floor"] * ppm)))
    meshes, windows = build(style, rng)
    scene = bpy.context.scene
    objs = {}
    for kind, bm in meshes.items():
        me = bpy.data.meshes.new(kind)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(kind, me)
        scene.collection.objects.link(ob)
        objs[kind] = ob

    gw, gh = style["_bays"] * style["bay"], style["_floors"] * style["floor"]
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(cw, ch) / ppm
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (gw / 2, -20.0, gh / 2)
    cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    world = bpy.data.worlds.new("black")
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    scene.world = world

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.seed = 0
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 0
    scene.cycles.transparent_max_bounces = 8
    scene.render.resolution_x, scene.render.resolution_y = cw, ch
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    out = out_dir / style["id"]
    out.mkdir(parents=True, exist_ok=True)
    for p in PASSES:
        scene.cycles.samples = 64 if p == "ao" else 16
        for kind, ob in objs.items():
            ob.data.materials.clear()
            ob.data.materials.append(material(f"{style['id']}:{kind}", kind, style, p))
        scene.render.filepath = str(out / f"{p}.png")
        bpy.ops.render.render(write_still=True)
    # Exact layout in pixels of the cell (y down): grid edges, floor and bay, each window.
    ox, oy = (cw - gw * ppm) / 2, (ch - gh * ppm) / 2
    to_px = lambda x, z: (ox + x * ppm, ch - (oy + z * ppm))
    layout = {
        "id": style["id"], "ppm": ppm, "cell": [cw, ch], "bays": style["_bays"], "floors": style["_floors"],
        "grid": [ox, oy, ox + gw * ppm, oy + gh * ppm],
        "floor": style["floor"] * ppm, "bay": style["bay"] * ppm,
        "windows": [dict(w, px=[*to_px(w["x"][0], w["z"][1]), *to_px(w["x"][1], w["z"][0])]) for w in windows],
    }
    (out / "layout.json").write_text(json.dumps(layout, indent=1) + "\n")
    print("FACADE", style["id"], f"{style['_bays']}x{style['_floors']}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--def", dest="def_path", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default=None)
    a = ap.parse_args(argv)
    cfg = json.loads(Path(a.def_path).read_text())
    for style in cfg["styles"]:
        if a.only and style["id"] != a.only:
            continue
        render(dict(style), cfg, Path(a.out))


main()
