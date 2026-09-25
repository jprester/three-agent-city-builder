"""Principled-BSDF materials driven by named palette colors."""
import bpy


def material(ctx, name, base, roughness=0.8, metallic=0.0, emission=None, emission_strength=0.0):
    """Get or create material `name`. `base` and `emission` are palette color names."""
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing

    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True  # deprecated no-op in Blender 5.x, required in 4.x
    except (AttributeError, TypeError):
        pass

    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    base_rgb = ctx.color(base)
    bsdf.inputs["Base Color"].default_value = (*base_rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic

    preview_rgb = base_rgb
    if emission is not None and emission_strength > 0:
        em_rgb = ctx.color(emission)
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        bsdf.inputs[key].default_value = (*em_rgb, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
        preview_rgb = em_rgb

    # Workbench previews use the viewport color, so make lit surfaces read as lit.
    mat.diffuse_color = (*preview_rgb, 1.0)
    return mat
