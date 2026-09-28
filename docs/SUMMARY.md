# Summary

State at the end of phase 6 (performance and polish), 2026-09-28. Phase 7 (external assets)
is optional and not started.

## What was achieved

- **A generated night city.**
  - 1,200 buildings in three districts: the old core, the tower district and the industrial port.
  - The buildings come from code-generated families: slabs, walk-ups, mid-rises, estates, car parks and setback towers with six crown types.
  - Blender runs headless as a build tool. Every GLB in `public/` is rebuilt from its generator and def, and identical inputs give identical outputs.
- **The hero canyon, the one bold element.** Neon blades and panels hang over a wet street from both sides, and the street reflects them as long smears. There are footbridges, traffic, rain, lamp pools and street haze. `canyon`, `fly-0` and `storefront` are the strongest shots.
- **Practical light first.**
  - Windows are shaded rather than modelled: rooms, blinds, curtains, warm and fluorescent interiors and rare TV-blue flicker, each with deterministic opening patterns.
  - Sodium lamps light the street, and sign light spills onto the facades and the road.
  - Neon is an accent. Most signs use your own artwork (the ChatGPT atlases and Midjourney ads), sized to each image's aspect. Tower campaigns sit low on the shafts, and brand lettering stands on the roofs.
- **Motion on one clock.** Rain, cars, flying vehicles and sign and window flicker all read one shared clock. `?t=` freezes everything, and two frozen renders are pixel-identical (a test checks this).
- **Cameras.**
  - **Orbit:** the development camera, with the 14 fixed viewpoints.
  - **Free-fly:** WASD, with collision against buildings.
  - **Flythrough:** a 3-minute cinematic loop: the canyon glide, a crane-up reveal, a tower orbit, a wide shot and a glide home (`docs/FLYTHROUGH.md`). Tests guarantee clearance from buildings, signs, bridges and the ground, plus gentle climbs and no whip pans.
- **Performance.**
  - One draw call for every building, prop and vehicle (BatchedMesh with a three-step LOD ladder).
  - At `high`: at most 40 draw calls and 0.86M triangles, with 24 of the 25-program budget used.
  - `low` halves the triangles. All presets hold 60 fps on an Apple M5.
- **Tests:** 67 unit tests (layout invariants on three seeds, flythrough, sign placement, collision) and 14 screenshot viewpoints with budget checks.

## Where it falls short of the style bible

- **Steam at street level is missing.** The haze post effect stands in for it. A particle system would need a 26th shader program, and the budget is 25.
- **"City to the horizon"** (`ref-aerial-dense`) is not met. The city is compact and ends at a hard square edge on a dark plain, and distant horizon lights only partly hide it. This is deliberate: an earlier far field made the city feel spread out, and you asked to keep the structure. A light-only ground carpet is proposed in `docs/QUESTIONS.md`.
- **Not quite "old, crowded, lived-in" up close.** Paint and tile are uniform per building (no patched or repainted floors), cars are simple boxes, and there are no parked vehicles. Pedestrians are out of scope by the plan.
- **Tower facades repeat** their photographic texture on all four sides. `tower-detail` is the weakest shot.
- **Some Latin text on signs** is still stroke-drawn and generic (HOTEL, NOODLE). Most signs now use your artwork.

## The three highest-value next steps

1. **Street-level steam and wet detail in the canyon:** vents and manholes breathing steam lit by the signs, plus puddles breaking up the reflection. It serves the one bold element directly. Budget one shader program for it by merging two existing materials (e.g. sidewalks and markings share the ground shader).
2. **Weathering variation per floor on the old slabs:** repainted bands, patched tile, rust streaks under AC units, all in the facade shader keyed by floor and seed. It moves the core from "clean procedural" to lived-in at no geometry cost.
3. **Soften the city edge**, if you agree: a light-only carpet of distant streets on the ground, or a harbour edge with piers and ship lights on the port side. It fixes the one composition problem left in `aerial` and the flythrough's wide shot.

See `docs/NOTES.md` for per-phase critiques, `docs/DECISIONS.md` for every deviation from the
plan, and `docs/progress/` for milestone shots.
