# Asset spec

Hard technical constraints. `npm run budgets` enforces the numeric ones.

## Units and orientation
- 1 Blender unit = 1 meter. Blender is Z-up; the glTF exporter converts to
  Y-up for three.js. Never rotate to compensate by hand.
- Origin at the center of the footprint, on the ground plane (z = 0).
- Buildings face -Y in Blender (their "front"), which becomes +Z in three.js.

## Naming
- Asset ids are the def path without extension: `buildings/tower_a`.
- Categories are the first path segment: `kit`, `props`, `buildings`.
- Blender materials are prefixed `M_`.

## Budgets
Defined per category in `pipeline.config.json` (triangles and file size after
optimization). Exceeding a budget fails `npm run check`.

## Geometry
- One mesh object per asset where possible; the optimizer joins primitives
  that share a material anyway.
- Flat shading unless a surface is genuinely curved.
- No hidden interior faces on repeated elements (they multiply by instance
  count at runtime).

## Vertex data
- UVs and color attributes may carry data for runtime shaders (e.g. facade
  coordinates in meters, surface-type ids). They survive export and optimization;
  remember glTF flips V (`v' = 1 - v`).

## Materials
- Principled BSDF only, driven by named palette colors.
- Emission strength above 1 is exported via KHR_materials_emissive_strength.
- No image textures yet. When textures are introduced, source files go in
  `art/textures/` and the optimizer must be extended to emit KTX2.
