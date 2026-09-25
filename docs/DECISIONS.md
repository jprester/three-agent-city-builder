# Decisions

One line per decision: `YYYY-MM-DD | area | decision | reason`.

2026-09-25 | pipeline | Optimizer runs prune({ keepAttributes: true }) | Default prune strips TEXCOORD_0 when no material texture uses it, which silently deletes facade UVs read by custom shaders.
2026-09-25 | pipeline | glTF export uses export_vertex_color=ACTIVE, export_attributes=True | Surface-type colors and custom attributes consumed by runtime shaders must reach the GLB deterministically as COLOR_0 / _NAME.
2026-09-25 | runtime | `?seed=` regenerates the layout in the browser from its def; runtime randomness derives from layout.seed | Layouts are prebuilt JSON, so a runtime seed could not otherwise change the city.
2026-09-25 | tests | Playwright `updateSnapshots: 'none'` | Playwright writes missing baselines by default, which would let the first agent run approve its own baselines.
2026-09-25 | process | Human checkpoints after phases 2, 5, 7 (added to PLAN.md) | Baselines are human-approved; foundations get reviewed before later phases build on them.
