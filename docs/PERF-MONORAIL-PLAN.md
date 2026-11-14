# Main app: performance work, then the monorail

Brief for an implementation session. Read `AGENTS.md` first; it is the working contract. This
file says what to build. Written 2026-11-14.

## Why this work

The human compared the fresh slice (`next/`) with the main app and judged the main app's look
clearly better. Bringing the slice up to that look would mean rebuilding most of what the main
app already has. The decision is the other way round:

1. Keep the main app as the product. Its look is settled and must not change.
2. Bring the slice's performance techniques into the main app.
3. Bring the slice's monorail and station into the main app.

The slice stays in the repo as reference. Do no further work in `next/`.

## Scope the human set

- A **realistic city with some futuristic elements**. No megastructures.
- The monorail is a **straight suspended line** (Chiba style). No curves, branches or grades.
- **The look of the main app does not change** in Part A. Every step is judged by before and
  after screenshots of the same viewpoints; a visible difference is a failure unless it is logged
  and clearly an improvement.
- The photographic tower facades stay as they are. Do not paint shader light over them.
- The main app stays on WebGL. Do not port it to WebGPU: the facade shader is about 1,000 lines
  of GLSL, and a rewrite would risk the look.
- Do not use `BatchedMesh` with thousands of sub-draws. It pinned 8–16 GB of GPU memory in this
  project once (fixed in commit 4d271db).

## Before starting

1. Branch `fresh-slice` has uncommitted work (`next/`, docs). Commit it there.
2. Merge `fresh-slice` into `main`. The slice only adds `next/` and docs; `src/`, `art/`,
   `public/` and `tools/` are identical on both branches, so the merge does not touch the app.
3. Work on `main`. Direct commits to `main` are fine.

## Where the main app stands

Measured with `npm run perf` on 2026-11-13 (1440×900 @2x, high quality, Apple M5):

| | Main app | Slice, for comparison |
|---|---|---|
| GPU time, median | 8.2–10.6 ms | 6.7–8.6 ms (start of frame to GPU done) |
| GPU time, 95th percentile | 13.8–18.4 ms | about 10–11 ms |
| GPU process memory | 1.77–1.89 GB | about 0.8 GB |
| Draw calls | up to 230–242 (budget 250) | 38–53 |

The two timing rows are measured differently; treat them as a rough comparison. The median is
already fine. The problems are memory, the slow frames at the 95th percentile, and almost no
draw-call headroom.

## How to measure

- Run `npm run perf` on an idle GPU. Close every other tab that shows either scene first, or
  each view reads about three times slower.
- Run each measurement three times and report the range. Runs differ by about 1.5 ms on this
  machine.
- GPU memory: `footprint <gpu-process pid>`, the "IOAccelerator (graphics)" line. The perf
  report's `gpuProcessMB` gives the same figure.
- Keep real-GPU browser runs short, frame-capped and one at a time. The machine swaps heavily.
- Before each step, save `npm run shots:all` output to `build/shots/before-<step>/`. After the
  step, shoot again and compare the same viewpoints side by side.

## Part A: performance

Targets, to be confirmed after step A0:

- GPU process memory under 1.2 GB at high quality.
- GPU time at the 95th percentile under 14 ms in all five perf views.
- At least 20 draw calls of headroom under the 250 budget (Part B needs them).

### A0. Find where the memory goes

The cause of the 1.8 GB is not yet measured. Before changing anything:

1. Record the baseline: three `npm run perf` runs and a `shots:all` set.
2. Measure the memory split by loading the app with groups switched off one at a time (tower
   texture arrays, wall atlas, interior atlas, sign atlas, render targets, geometry) and reading
   the GPU process footprint each time.
3. Write the table in `docs/NOTES.md`. If textures are not the largest share, reorder the steps
   below to match what you found and log the change in `docs/DECISIONS.md`.

### A1. Compressed textures (KTX2)

Expected to be the largest saving. `src/materials/textures.ts` loads three tower bundles
(diffuse, emissive, normal each), the wall atlas and the interior atlas as WebP, which the GPU
holds uncompressed with full mip chains.

- Add a build step that encodes them to KTX2 (Basis Universal). Use UASTC for normal maps and
  for the emissive window maps if ETC1S smears the small lit windows.
- Load them with three's `KTX2Loader`. Bundle the transcoder locally: the app makes no runtime
  network requests.
- The sources in `art/external/textures/` stay untouched. The encoded files are generated
  outputs: scripts are the source of truth, and the files are never hand-edited.
- The encoder is a new build tool. Log it in `docs/DECISIONS.md`, and document how to install it
  under "Environment" in `AGENTS.md` only if the human approves; otherwise note it in
  `docs/QUESTIONS.md`.
- Judge it on `tower-detail`, `glass`, `facade`, `storefront` and `skyline`. Block artefacts on
  lit windows or banding in the normal maps are failures: raise the quality setting before
  accepting them.
- If compression cannot hold the look for one map, leave that map uncompressed and say so.

### A2. Road reflection

Read `src/scene/reflection.ts` first and record what it does now. The slice's reflection
(`next/src/reflection.ts`) is quarter resolution and draws small parts only within 90 m of the
camera. Apply whichever of the two the main app does not already do. Judge on `canyon`,
`storefront` and `fly-25`: reflected signs and headlights on the wet road must look the same.

### A3. Distance cut-offs for small parts

Read `src/systems/instancing.ts` and `src/systems/buildings.ts` first and record what is culled
now. The slice groups small parts (AC units, balconies, props) into 250 m chunks, lets the
renderer skip chunks outside the view, and hides chunks further than about 420 m. Parts that
emit light stay visible at any distance so lamps still dot the far city.

- Apply the same idea where the main app draws small parts at distances nobody can see them.
- Judge on `aerial`, `skyline-wide`, `horizon` and all four `fly-*` frames. Parts must not pop
  in during the flythrough: watch it run, do not rely on stills alone.

### A4. Gates

- Add a GPU process memory budget to `pipeline.config.json` (`scene.maxGpuProcessMB`), set about
  15% above the measured result, and enforce it in `npm run perf`. The slice does this in
  `next/budgets.json` and `next/tests/slice.spec.ts`.
- The scene's `maxFrameMs` is 50. Propose a tighter value in `docs/QUESTIONS.md`; do not change
  it without the human.

### Checkpoint A

Write `docs/CHECKPOINT.md`: the before and after table (memory, median and 95th-percentile GPU
time, draw calls, triangles) per perf view, the screenshot pairs to look at first, and anything
that changed visibly. Commit and stop for review.

## Part B: the monorail

Start after checkpoint A is reviewed.

### What to carry over

The design, not the code. The slice builds everything from boxes in TypeScript on WebGPU. In the
main app, assets are Blender generators with defs, placed by the layout generator
(`AGENTS.md`, "Where things go").

Reference in the slice:

| What | Where |
|---|---|
| Dimensions | `next/src/plan.ts`, the `monorail`, `stair` and `deck` fields |
| Girders, piers, station, stairs | `next/src/build.ts` |
| Cars and timetable | `next/src/train.ts` |
| Description | `next/README.md`, sections "Monorail" and "Monorail detail" |
| Images | `docs/progress/fresh-slice-monorail/`, `docs/progress/fresh-slice-monorail-detail/` |

Key dimensions: two box girders, one per direction, underside at 11.7 m; T-shaped piers in the
median every 30 m, none inside junctions; cars hang beneath with their floor at 8 m, leaving
7.7 m clear over the road; three cars per train; side platforms at 8 m under a roof on portal
frames that stand on the sidewalks; a pedestrian deck at 5.6 m with open stairs.

### B1. Route (layout)

- Choose the straightest arterial through the core, preferably one that ends toward the tower
  district so the towers close the view down the line. It needs a median for the piers: add it
  as a layout param.
- Generate the monorail last in `art/layouts/city.mjs`, the way the island band is, so it does
  not shift the random stream of the rest of the city. The existing city must come out
  identical apart from what the line displaces.
- Clear the envelope along the route: footbridges across that street, signs on arms over the
  road, sky lanes and street lamps under the girders. Remove or move them in the layout, do not
  let them intersect.
- Check the flythrough path against the structure.
- One station, at a block where the sidewalks are wide enough for the portal legs and stairs.
- Layout generators run in Node and the browser: no Node APIs. Add unit tests for the route
  (straight, piers clear of junctions, nothing inside the envelope).

### B2. Assets (Blender generators)

Build modular pieces that repeat, each inside the existing per-asset budgets:

- pier, girder span (30 m, with ribs, joint, cable tray and the light line underneath);
- station pieces: platform bay, portal frame, roof bay, platform screen with door gaps, open
  stair flight and landing, deck segment;
- car: end car and middle car, with door recesses, a lit interior behind the window band,
  hangers and the tapered nose.

Rules: params with defaults via `ctx.p(...)`, colours from `art/style/palette.json` by name,
randomness from `ctx.rng`. Reuse the facade-shaded prop path that the walkers and signals use,
so the monorail adds no new shader program. If a piece cannot fit the `props` or `vehicles`
budget, do not raise the budget: split the piece, or put the question in `docs/QUESTIONS.md`.

Look at every preview in `build/previews/<id>/` and judge it against the style bible and the
slice images. The slice's cars and station are blockouts; the main app's versions should be
better than them, with rounded forms where the slice has facets.

### B3. Motion and light

- Trains are a pure function of time, like the rest of the app's motion, so frozen times stay
  reproducible. Timetable from the slice: one train per direction, half a cycle apart, a 12 s
  stop at the station.
- The light line under each girder, the platform tubes and the pier collars should light their
  surroundings through the app's existing lamp map (`src/scene/lampmap.ts`), not through light
  objects.
- Rain should not fall through the station roof. If the rain system has no occluders, log that
  in `docs/NOTES.md` and leave it.

### B4. Budgets and views

- At most 8 extra draw calls and 80,000 extra triangles in any view, and no new shader program.
  If that cannot be met, say what it costs and ask.
- Add viewpoints in `src/debug/viewpoints.ts`: along the line from the street, under the
  viaduct, and on the platform with a train stopped.
- Run `npm run perf` again and compare with checkpoint A.

### Checkpoint B

Follow the verification loop in `AGENTS.md`. Write a harsh critique in `docs/NOTES.md`, copy the
shots to `docs/progress/monorail/`, update `docs/CHECKPOINT.md`, commit and stop for review.

## Not in this brief

The slice's signs sized to their text, its walk and free-fly cameras, its traffic and rain
compute passes, and its fixture-light maps. They may come later; do not start them here.
