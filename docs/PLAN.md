# Night City — Project Brief

This brief is for a procedurally generated, real-time futuristic night city in three.js. It should include a cinematic flythrough and a free-fly mode, run at 60 fps in the browser, and look like a deliberate art piece rather than a tech demo.

The project is built on `three-agent-template`. **`AGENTS.md` is the binding working contract.** This brief defines *what* to build; `AGENTS.md` defines *how* to work. If the two conflict, follow `AGENTS.md` and log the conflict in `docs/DECISIONS.md`.

Place this file at `docs/PLAN.md`. Read all of it, plus `AGENTS.md`, before changing anything.

---

## 1. Additional working rules

These rules apply on top of `AGENTS.md`.

- Work phase by phase (section 8). Do not start a phase until the previous phase's acceptance criteria pass.
- End every phase with the following sequence:
  1. Run `npm run check`.
  2. Run `npm test`.
  3. Run `npm run shots`. Baseline diffs will fail the run; that is expected, so read `build/shots/` regardless of the result.
  4. Open every screenshot, and every Blender preview for assets you touched.
  5. Write a critique in `docs/NOTES.md` under the phase heading. Say what looks wrong, generic or unconvincing against the style bible, and what you will change. Be harsh; "looks fine" is not a critique.
  6. Fix what you found and re-shoot.
  7. Copy `build/shots/city/` to `docs/progress/phase-<n>/`.
  8. Commit.
- Iterate on visuals at most 3 rounds per phase. After that, log what remains in `docs/NOTES.md` and move on. Phase 8 is for polish.
- Never run `shots:approve`. Baselines are the human's call, made at checkpoints.
- Do not stop to ask questions. When something is ambiguous, pick a sensible default, record it in `docs/DECISIONS.md` with a one-line reason, and continue. Put questions only a human can answer in `docs/QUESTIONS.md`. The only planned stops are the checkpoints below.

### Checkpoints

Phases 2, 5 and 7 end with a checkpoint. They lock in the decisions everything after them builds on: the layout and facade shader, the hero canyon shot, and the full flythrough.

At a checkpoint, after completing the phase-end sequence:

1. Write `docs/CHECKPOINT.md`, replacing any previous content. Cover what changed in this stretch, which shots to look at first and why, the known weaknesses in your own words, open questions from `docs/QUESTIONS.md`, and what you plan next.
2. Commit, then stop the session and say that a checkpoint is waiting for review.

The human reviews the shots, approves baselines with `npm run shots:approve`, and writes feedback in `docs/NOTES.md` under a `Human review — checkpoint <n>` heading. When work resumes, read that feedback first. It overrides your own critique, and addressing it comes before starting the next phase.
- Make no runtime network requests. Do not use real brand names, logos or existing copyrighted text in signage.

## 2. Allowed dependency additions

- `postprocessing` (pmndrs), for post effects. It merges effects into fewer passes than three's EffectComposer.
- `lil-gui`, for debug tuning. Show it only with `?debug=1`.
- `vitest`, for unit tests of layout generators. Add an `npm test` script.

Anything beyond these needs a reason in `docs/DECISIONS.md`.

## 3. Where each part of the city is generated

The template's split is scripts as the source of truth, Blender run headless, and layouts as JSON instance lists. It maps onto this project as follows.

### Blender generators (`art/generators/`, defs in `art/defs/`)

These produce everything with real geometry that repeats:

- **Buildings.** Several families, each with variants from defs (aim for 20–30 variants in total):
  - old residential slabs with balconies, cage windows and facade AC units;
  - mid-rise mixed-use blocks with podiums;
  - setback towers.
- **Rooftop props.** Water tanks, AC clusters, antenna masts, billboard frames, stair huts.
- **Street props.** Lamps, barriers, kiosks, vent stacks.
- **Signs.** Sign brackets and frames.
- **Vehicles.** A flying vehicle hull.
- **Skyline.** Low-poly skyline blocks for the distant ring.

### Layout generator (`art/layouts/city.mjs`, def `art/layouts/defs/city.json`)

This produces everything that is *placement*, all deterministic from the seed:

- the road network, blocks, lots and districts;
- building instances: variant id, position, rotation, per-instance seed, scale;
- prop, lamp and sign placements;
- traffic lane splines;
- the flythrough camera spline.

It writes `public/layouts/city.json`. Replace the sample `district_a` layout with it once `city` works.

### Runtime (`src/`)

This covers what is inherently shader-, time- or camera-dependent:

- the facade material;
- road and sidewalk surfaces built from the layout JSON;
- the sign atlas;
- sky, fog and rain;
- traffic motion;
- cameras;
- post-processing.

## 4. Key technical decisions

### One geometry, one material per building variant

The Blender building generators encode the surface type in `COLOR_0`: facade, podium/storefront, roof and trim. Everything then uses a single runtime facade material. This keeps draw calls at roughly one per variant rather than one per variant per material slot.

This requires two changes in the generators:

- Add a helper in `art/generators/lib/` for writing the surface-type color attribute.
- Add a UV helper that writes **facade coordinates in meters** into `TEXCOORD_0`: u runs along the facade, v runs up it.

### Windows are shaded, not modeled

The runtime material extends `MeshStandardMaterial` via `onBeforeCompile`, so fog, tone mapping and lighting keep working. The fragment shader:

1. hashes each window cell from the facade-meter UVs plus the per-instance seed;
2. picks lit or unlit, a color temperature and a blinds pattern;
3. applies a rare TV flicker driven by the shared time uniform;
4. outputs emissive.

Podium surfaces get storefront treatment instead of windows.

Two requirements:

- **Scale compensation.** Buildings may be non-uniformly scaled per instance. The vertex shader derives the scale from the `instanceMatrix` column lengths and multiplies the facade UVs by it, so window cells stay about 3 m tall regardless of scale.
- **Anti-aliasing is mandatory.** Fade window detail toward an averaged facade color using `fwidth`/distance, so distant facades don't shimmer or moiré.

### Culling and draw calls

Evaluate `BatchedMesh` (all building variants in one object, with per-instance frustum culling) against per-variant `InstancedMesh` with chunked culling. Pick one using the draw-call and triangle numbers from the shots, and log the choice.

### Lighting

Emissive surfaces, fog and bloom carry the look.

- No shadow maps.
- At most a handful of real lights, all near the camera.
- Lamp pools on the ground are faked with additive radial gradients in the ground shader, positioned from the layout's lamp list.

### Wet streets

Start with a half- or quarter-resolution planar reflection, distorted by a noise normal and stretched vertically into long smears. If the budget doesn't allow it, fall back to an environment-map approach and log the decision.

### Sign atlas

At startup, draw a single canvas atlas of N invented signs:

- a mix of CJK-looking and Latin text;
- neon tube strokes with glow;
- some boxed backlit panels.

The signs render as instanced quads. Per-instance attributes carry the atlas rect, color, and flicker or broken-tube parameters.

**Bundle the font.** Put an open-licensed font subset (e.g. a Noto Sans CJK subset of a few hundred glyphs) in `art/external/` with a manifest entry, load it via `FontFace` before drawing, and gate `__READY` on it. Otherwise screenshots will depend on whatever system fonts the machine has.

### Rain

Rain is a camera-relative volume of instanced streaks that wraps around the camera. Do not scatter points across the whole world.

### Traffic

- **Ground traffic:** instanced headlight/taillight pairs moving along the layout's lane splines. They should read as rivers of light from above.
- **Flying vehicles:** a few instanced hulls on spline lanes at two or three altitude layers, with blinking navigation lights.

### Post-processing

- Bloom: mipmap blur, with the threshold tuned so only emissives bloom.
- Tone mapping: AgX or ACES, chosen by eye.
- Subtle vignette, grain and chromatic aberration.
- SMAA.
- Half-float buffers.
- Pixel ratio clamped to 1.5.

### Cameras

- **Orbit:** the template's existing mode, for development.
- **Free-fly:** WASD, mouse look, shift to boost.
- **Cinematic flythrough:** follows the layout's spline, eased. It starts in the hero street canyon, rises past the signs and rooftops, sweeps over the city, ends wide, and loops.

Keys 1, 2 and 3 switch modes.

## 5. Extensions to the template's visual loop

### URL parameters

Add these alongside the existing `?layout=` and `?viewpoint=`:

| Parameter | Effect |
|---|---|
| `?t=<seconds>` | Freezes all animation at that time. Everything time-based reads one shared clock. |
| `?seed=<int>` | Regenerates the layout in the browser from its def with this seed, instead of loading the prebuilt JSON (the template supports this). All runtime randomness (window hashes, sign choice, traffic offsets) derives from `layout.seed`, so one number reproduces the whole city. Shots always use the prebuilt layout. |
| `?debug=1` | Shows the debug GUI. |
| `?quality=low\|med\|high` | Selects a quality preset. |

### Readiness, stats and scene budgets

- Expose `window.__STATS` with `renderer.info` data (draw calls, triangles, programs, textures, geometries) after the ready frame.
- Extend `tests/visual/shots.spec.ts` to:
  - load every viewpoint with `&t=12`;
  - write `build/shots/city/info.json`;
  - fail with a clear message when a new `scene` section in `pipeline.config.json` is exceeded.

### Viewpoints

Replace `src/debug/viewpoints.json` with these:

| Name | Framing |
|---|---|
| `canyon` | Street level, looking up and along the hero street. |
| `storefront` | Eye height, close podium and sign detail. |
| `rooftops` | About 60 m up, looking across rooftops toward the towers. |
| `aerial` | About 400 m up, wide establishing shot. |
| `horizon` | Low angle toward the city edge and the skyline ring. |
| `fly-0`, `fly-25`, `fly-50`, `fly-75` | Positions along the flythrough spline. Add a `"flythrough": 0.25`-style field supported by `applyViewpoint`. |

### Critique questions

Judge each shot against the style bible:

- Is there depth layering from near to far?
- Is the palette motivated, or has it drifted to magenta and cyan?
- Is anything grid-like that should be irregular?
- Does distant geometry shimmer?
- Is the canyon shot actually striking?

## 6. Budgets

- **Frame rate:** 60 fps at 1440p on an Apple Silicon Mac during the flythrough, at `high` quality. The human measures this. SwiftShader frame timings are meaningless, so the agent enforces the counts below instead.
- **Scene limits** (`pipeline.config.json` → `scene`): at most 250 draw calls, 3M triangles and 25 shader programs on any viewpoint.
- **Asset limits:** keep the template's existing per-asset triangle and size limits. Raise the buildings budget only with a logged reason.
- **Quality presets** scale reflection resolution, bloom levels, rain count, sign count, pixel ratio and LOD distances. At `low`, draw calls and triangles should come in at roughly half of `high`.

## 7. Tests (vitest)

- **Layout determinism:** the same seed produces the same layout hash.
- **Layout invariants:**
  - no building footprint overlaps a road;
  - footprints stay inside their lots;
  - every sign sits on a building face that fronts a street.
- **Flythrough spline:** never passes through a building footprint below roof height.

## 8. Phases

**Phase 0 — Verify and adapt the template**
- Confirm the three items the template's author could not test:
  1. `npm run assets` with the real Blender binary;
  2. the three.js runtime render in the browser and `npm run shots`;
  3. storefront sign orientation.
- Fix whatever breaks.
- Rename the project to `night-city`.
- Replace `art/style/style-bible.md` and `art/style/palette.json` with Appendix A. The current palette's cyan/magenta defaults are exactly what this brief avoids.
- Add the section 5 extensions and the dependencies from section 2.
- Keep `art/layouts/*.mjs` browser-safe (no `node:` imports, no `process`); `npm run layouts` enforces this so `?seed=` keeps working.
- Accept when: real-Blender assets build, the shots are non-black, `info.json` is written, and `npm run check` passes.

**Phase 1 — Layout**
- Write `art/layouts/city.mjs`, producing:
  - a road hierarchy of arterials, secondary streets and narrow alleys, irregular rather than a perfect grid;
  - blocks and lots;
  - three districts: a dense old core of 10–25 floors packed tight, a tower cluster of 150–400 m, and a lower industrial/port edge;
  - the hero street, marked in the layout;
  - a ring of distant skyline placements.
- Use the existing sample tower variants as placeholders.
- Build runtime road and sidewalk surfaces from the layout.
- Write the layout tests.
- Accept when: `aerial` reads as a city with hierarchy and districts, and the budgets hold.

**Phase 2 — Buildings and facade shader**
- Write the building generator families and variant defs, with the facade-UV and surface-type helpers.
- Write the runtime facade material with scale compensation and anti-aliasing.
- Retire the sample tower assets once replaced, and log it. This includes the template's modeled-window `kit/window_frame` usage in buildings; windows are shaded from now on. Kit modules stay available for non-window detail.
- Accept when:
  - the Blender previews show distinct families;
  - `canyon` and `storefront` show believable, varied windows;
  - `aerial` shows no shimmer.
- **Checkpoint 1.**

**Phase 3 — Atmosphere and post**
- Add a sky dome with light-pollution glow, fog (height-attenuated if feasible), street-level haze and the post-processing stack.
- Accept when: `horizon` and `aerial` show clear depth layering and the palette matches the style bible.

**Phase 4 — Streets and props**
- Write the prop generators and add prop placement to the layout.
- Add facade AC units, rooftop clutter, lamps with light pools, and wet reflective streets.
- Accept when: `canyon` shows readable reflection smears and street level no longer looks empty.

**Phase 5 — Signage**
- Write the sign bracket and frame generators.
- Add sign placement to the layout: dense along the hero street, sparse elsewhere.
- Build the runtime atlas with the bundled font, plus flicker and broken tubes.
- Accept when: `canyon` is the strongest shot in the set.
- **Checkpoint 2.**

**Phase 6 — Motion**
- Add rain, ground traffic on the lane splines, flying vehicles, and window and sign flicker, all driven by the shared clock.
- Accept when: the `fly-*` shots show traffic and rain, and frozen-time renders are identical across runs.

**Phase 7 — Cameras**
- Implement the free-fly and flythrough modes.
- Tune the layout's flythrough spline so it threads the hero canyon.
- Write `docs/FLYTHROUGH.md` describing the path, so the human can judge pacing.
- Accept when: the `fly-*` shots form a coherent sequence and the spline test passes.
- **Checkpoint 3.**

**Phase 8 — Performance and polish**
- Add LOD variants via defs, for example a no-detail version of each building family for distant use.
- Add quality presets.
- Work through every open item in `docs/NOTES.md`.
- Do a final critique round across all shots with fresh eyes.
- Accept when: all budgets hold at `high`, and `low` roughly halves the draw calls and triangles.

**Phase 9 (optional) — External assets**
- If the human provides the low-poly cyberpunk building pack (glTF buildings with shared texture atlases, in residential, high-rise and skyscraper tiers), bring it in through `art/external/` with manifest entries.
- Let the layout mix pack buildings into matching tiers.
- Skip this phase if the pack is not provided.

## 9. Out of scope

Gameplay, audio, touch controls, pedestrians, physically accurate lighting and any server component are out of scope.

## 10. Final deliverable

The repo should run with the template's quick start and have a `README.md` covering controls, URL parameters and quality presets. `docs/` should contain `NOTES.md`, `DECISIONS.md`, `QUESTIONS.md`, `FLYTHROUGH.md` and the progress shots.

Finish with `docs/SUMMARY.md`, covering:
- what was achieved;
- where the result falls short of the style bible, and why;
- the three highest-value next steps.

---

## Appendix A — Style bible content (copy into `art/style/`)

### Reference world

The reference is a late-20th-century Asian megacity pushed one step into the future: Mong Kok, Kowloon and Nathan Road density; Y2K techno-optimism gone shabby; wet streets at 2 a.m. The city is old, crowded and lived-in, with newer glass towers rising out of it. It should not read as clean chrome.

### The one bold element

The hero element is the street canyon. At street level, looking up through a narrow gap, neon signs project over the road from both sides. The wet asphalt reflects all of it as long vertical smears.

Everything else supports this shot and stays comparatively quiet.

### Light

Light should mostly be practical and motivated: sodium lamps, fluorescent tubes in apartments, warm tungsten, TV flicker. Saturated neon is an accent, not the base.

Do not default to magenta and cyan everywhere.

### Details that sell it

- rooftop clutter
- AC units dotting facades
- blinds in some windows
- a TV-blue flicker in a few
- elevated walkways or a flyover
- steam or haze at street level
- rain

### Palette (`palette.json`)

Keep any existing keys that the generators still reference, remapped to these values.

```json
{
  "sodium": "#FF9A3C",
  "fluorescent": "#D8F5E0",
  "tungsten": "#FFC98A",
  "tv_blue": "#7FA8FF",
  "sign_red": "#FF3B30",
  "sign_amber": "#FFB347",
  "sign_cyan": "#3DE0E8",
  "haze": "#2A1E24",
  "sky": "#140F16",
  "concrete": "#55524C",
  "concrete_dark": "#34322E",
  "tile_stained": "#6B6A5E",
  "metal_dark": "#1C1E22",
  "glass_dark": "#0D1520",
  "road_wet": "#0E0F12",
  "sidewalk": "#24231F"
}
```

`sign_cyan` is used sparingly.
