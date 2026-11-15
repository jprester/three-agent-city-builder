# 3D tooling research: state of play (as of 2026-11-15)

This was compiled in a claude.ai chat that couldn't see the repo. Read it as **inputs to weigh against the current state of the project**, not as directives. Versions and dates come from web sources on 2026-11-15, so re-check before you depend on one.

## TL;DR for Night City

- The procedural core (headless Blender generators plus layouts, all in the repo) is still the right architecture. Nothing new replaces it.
- Frontier models can now produce a large procedural city in a single prompt. GPT-6 Astra rebuilt Hangzhou in three.js in about 24 minutes. Night City won't stand out for generating a city. It has to stand out for **art direction, camera and lighting**, so spend effort there.
- **Pin the three.js version and give agents version-matched docs.** The WebGPU/TSL APIs churned in 2026, and model training data lags behind them (see the three.js section).
- One addition worth testing: **Gaussian splats for the far-field skyline only** (see the splats section).

## three.js state

- Current release is **r185**. `three/webgpu` (WebGPURenderer, which falls back to WebGL2) is now the path the project recommends. Remember `await renderer.init()`.
- **r183 renamed PostProcessing to RenderPipeline**, a class built for WebGPURenderer, with output defined via `outputNode`. Older agent knowledge will suggest EffectComposer-era bloom code. Check which renderer the repo actually uses before you accept post-processing changes.
- r183 also gave BatchedMesh per-instance opacity and wireframe. That's useful for city LOD fades.
- **r186 (on the dev branch) adds a native Gaussian splat renderer**, implemented in WebGPU/TSL, with PLY, SPZ, KSPLAT and glTF loaders.
- WebGPU caveat: Firefox on Linux, Android and Intel Macs had no stable support as of mid-2026, so the WebGL fallback still matters.
- Model knowledge cutoffs: GPT-6 Astra stops at April 2026, and others are similar. TSL and RenderPipeline code from memory is likely to be stale.

## Blender

- **Blender 5.3 was released 2026-11-10.** It's a regular release, not LTS.
  - Native Gaussian splat import (PLY, SPZ, USD, glTF) with rendering in Workbench, EEVEE and Cycles. **No splat export.** Splats are stored as a new point-cloud type, and Geometry Nodes gets new `Import SPZ` and `Set Point Cloud Type` nodes.
  - Known bug: **Apply Transform corrupts splat attributes.**
  - New optional **Blender Projects** system, which lets Blender understand a project root beyond the open .blend file. That fits the repo-as-source-of-truth setup.
  - Also new: DLSS denoising, EEVEE Material Lighting nodes, and Vulkan as the default backend on Windows and Linux.
- **5.2 LTS gets fixes until July 2028.** Recommendation: keep the headless generator pipeline pinned to 5.2 LTS unless you need splats.

### Blender MCP: two lineages, don't run both at once

- **Official**: Blender Lab (projects.blender.org/lab/blender_mcp). v1.0.0 shipped 2026-04-27 and became the official Claude connector the next day. Requires Blender 5.1+. Current version is v1.0.3 (2026-09-11), which includes a **screenshot capture fix**. That may make the old `size_limit_in_bytes=120000` workaround unnecessary, but test it.
- **Community**: ahujasid's server, renamed **mcp-for-blender** in Sept 2026 (2.2.x). It integrates Poly Haven, Sketchfab, Poly Pizza, Hyper3D Rodin, Hunyuan3D, Meshy and Tripo (bring your own key). It had four CVEs in 2026, including a path traversal in the Poly Haven downloader, plus opt-in telemetry and a paid "Premium" generation service. Use it only if you need those integrations.
- Blender accepts only one MCP client per session.
- **For this repo, MCP is for inspection, not authoring.** The generator scripts stay the source of truth. MCP or headless rendering exists to close the visual loop: render, inspect the image, patch the script.

## Gaussian splats (the new lane)

- **Spark 2.0** (World Labs, MIT): a splat renderer for three.js on WebGL2 that streams worlds of 100M+ splats with LoD to desktop, iOS, Android and VR. There's also **Spark Radix** (0.0.1, experimental), which renders through WebGPU and sorts on the GPU.
- **Marble** (World Labs) generates splat worlds from an image, text or a 3D layout, and can also output a **collider mesh**. Since Oct 2026 there's a `posedImages2Splats` API (beta, about $5 per run). **Chisel** turns blocky Blender layouts into detailed splat environments.
- Reference project: **World Labs ICARE**. Three people built it in about two months. It's a custom three.js runtime that mixes streamed splats with ordinary mesh characters, props, terrain, VFX and UI, and it has a Blender integration hooked into the live runtime.
- **What this means for Night City:** splats bake their lighting in, which suits a static night backdrop but fights dynamic neon, bloom and moving lights close up. If you try them, use them only for distant megastructures and the skyline. Keep everything near the camera as procedural mesh. This is an experiment, not a migration.

## Asset sources agents can fetch (complements Janko's notes)

These are already covered in the notes: Polyfork, sand3d, Scenario skills, Quixel/Megascans (free on Fab, AI training allowed), the 3D Asset Server MCP, Poly Haven, Sketchfab, Rocketbox GLB, Tesseract and vork.

New in this research:
- **Image-to-3D generators, late 2026**:
  - Meshy 7.1 (Sept 2026). Free-tier outputs fall under **CC BY 4.0**.
  - Tripo P2 / Smart Mesh: game topology, quads, auto-rig.
  - Tripo H3.1: high detail.
  - Rodin Gen-2.5: high fidelity.
  - Hunyuan3D 3.1: hosted only. The last open weights are version 2.1.
  - TRELLIS.2: MIT, self-hostable.
  - None of them are truly game-ready without QA (scale, pivot, UVs, normals, budget).
- **Hybrid asset pattern**, shown with Astra: split the reference into parts, generate the complex parts with an image-to-3D model, build the regular details procedurally, then assemble everything into one structured object.
- **Google Three-Live** (Apache-2.0, dev preview): compiles a sandboxed, declarative subset of three.js to GLB or USDZ, with a `<three-live>` element and AR handoff. Not useful for Night City. It might suit small AR previews.

## Characters and animation (mainly for the tactical magic game, also city crowds)

- **Text-to-motion is now usable.**
  - **HY-Motion 1.0** (Tencent, open source since 2025-12-30): text in, joint rotations on a humanoid (SMPL) skeleton out, then retarget onto your character.
  - Hosted options: Uthana Text to Motion 3.0 (auto-retargets, exports GLB or FBX), Meshy animation library, Sorceress / Cinevva browser auto-rig plus motion.
  - Most riggers and motion models are **humanoid only**.
- Suggested stack: **Rocketbox GLB** avatars (rigged, 175 face blendshapes) plus HY-Motion clips, played through `THREE.AnimationMixer`.
- **World Labs third-person controller** (open source) uses Marble splats and a collider mesh, Spark 2.0 and Rapier, which is the planned game stack. The collider mesh can also serve guard line-of-sight raycasts.
- The fal guide "How to build a game with GPT-6 Astra" builds a stealth game with vision cones and line-of-sight. That's close to the minimal game prototype.

## Models and orchestration

- Opus 5.5 (2026-09-22) and GPT-6 Astra (2026-09-03) both handle Blender and three.js well. In a public Blender F1-car test, Opus 5.5 gave better quality but cost about $27.86 and took 1h07m, against $4.50 and 48 minutes for GPT-6 Sol. Choose by cost per accepted output, not per prompt.
- **Self-hosted / Hermes route (prefer open-weights models here):** Kimi K3 works with Blender MCP in a "vision in the loop" way (script, render, inspect, revise). GLM-5.2, Qwen3-Coder-Next and DeepSeek V4 are other open-weights candidates. Because the repo uses headless Blender scripts as source of truth, a VPS loop doesn't need MCP: headless render, then an open model reads the image, then it patches the script.
- Proven orchestration pattern from the demos: one orchestrator model runs the pipeline, other models only make assets, and a **style ledger** (prompts that worked, saved to JSON and fed back into the next generation) keeps the look from drifting. Keep rooms and scenes small and dense.

## Suggested experiments (low cost, high information)

1. Confirm the repo's three.js version and renderer. If it's on WebGPU, make sure post-processing uses RenderPipeline.
2. Add an automated render-and-inspect step to one generator, e.g. headless render, then a vision model scores it against a style brief.
3. Spike: put one Marble or Chisel splat skyline behind the procedural city using Spark 2.0, and judge it at night with bloom on.
4. Separate project (game): Rocketbox guard plus an HY-Motion patrol clip plus Rapier in one room.

## Sources

- Blender MCP comparison: https://www.strayspark.studio/blog/official-blender-mcp-server-comparison-2026
- Blender MCP history: https://aiwiki.ai/wiki/blender_mcp
- Blender 5.3: https://radiancefields.com/blender-5-3-ships-with-native-gaussian-splat-support · https://maverickframe.com/blog/blender-latest-version/ · https://digitalproduction.com/2026/09/22/blender-5-3-brings-gaussian-splats-home/
- three.js r183: https://app.cinevva.com/news/2026-03-18-threejs-r183-render-pipeline
- three.js WebGPU migration (r185): https://www.buildmvpfast.com/blog/threejs-webgl-to-webgpu-renderer-migration-2026
- three.js r186 splats: https://radiancefields.com/three.js-merges-a-native-gaussian-splat-renderer-for-webgpu-in-r186
- Spark 2.0: https://worldlabs.ai/blog/spark-2.0
- ICARE: https://www.worldlabs.ai/case-studies/icare
- Third-person controller: https://www.worldlabs.ai/third-person-controller
- Three-Live: https://opensource.googleblog.com/2026/11/introducing-three-live-ai-generated-3d-ar-webxr.html
- AI 3D generators: https://app.cinevva.com/guides/ai-3d-model-generators · https://www.entagl.com/blog/ai-3d-generation-2026-product-ar-creative
- Text-to-motion: https://app.cinevva.com/guides/ai-animation-generators-3d · https://sorceress.games/blog/run-an-ai-3d-animation-generator-no-maya-license
- Astra 3D / Hangzhou: https://decrypt.co/377514
- Opus 5.5 vs Sol in Blender: https://betterstack.com/community/guides/ai/opus-55-vs-gpt6-blender/
- Kimi K3 + Blender MCP: https://youmind.com/ru-RU/landing/x-viral-articles/kimi-k3-blender-mcp-workflow
- fal stealth-game guide: https://fal.ai/learn/tools/how-to-build-a-game-with-gpt-6-astra

---

# Assessment against this repo (2026-11-15)

Written in a Claude Code session with the repo open. It weighs the research above, plus the
human's own notes on Polyfork, sand3d, Scenario, Tesseract, vork, Rocketbox and the 3D Asset
Server, against the current state of the project. Tool descriptions come from those notes and
from web searches, mostly the vendors' own pages; nothing about the tools themselves was
tested. What was tested is marked.

## Already done or already true

- **Blender is pinned to 5.3** (commit `b07f521`). Tested: all 142 assets rebuild
  byte-identical to the committed GLBs, and Workbench previews are pixel-identical for the one
  asset compared. Not tested: `npm run interiors` (Cycles room cards). Blender 5.3 bundles
  Python 3.13.
- **three.js is pinned at 0.187.0**, newer than the r185 the research calls current. The main
  app (`src/`) is WebGL with pmndrs `postprocessing`. The fresh slice (`next/`) is WebGPU and
  already uses `RenderPipeline`.
- **The native splat renderer is installed** (`three/examples/jsm/objects/GaussianSplat.js`,
  SPZ/PLY/KSPLAT loaders). It imports from `three/webgpu`, so it works in `next/` only; the
  main app would need Spark 2.0.

## Verdicts

| Item | Verdict | Reason |
|---|---|---|
| Poly Haven / Megascans surface textures | **Try (task 1)** | The notes keep recording flat, untextured concrete and platforms. CC0, fits `art/external/` + KTX2. |
| sand3d | **Try (task 2)** | Built on `bpy`, deterministic, has fillets. The most repeated complaint is planar facets on cars and the train nose. |
| Splat skyline (Marble, Chisel) | Later, `next/` only | The human removed the far field once for cohesion; megastructures are out of scope. Needs a paid splat source. |
| Lit EEVEE night preview for assets | Later, small | Workbench previews do not show emissives at night. `tools/blender/previews.py` already has an `eevee` switch. |
| Image-to-3D (TRELLIS.2, Meshy, Tripo) | Later, one hero prop at most | Outputs are 200k–400k faces against a 1,500-triangle vehicle budget, with no facade-shader data. |
| Scenario skills | Later, hero props only | Seamless PBR and `patina-retexture` are relevant but paid per generation; Poly Haven covers tiling surfaces free. |
| 3D Asset Server MCP | When external assets start | One search across 23 sites with licence info, which `art/external/manifest.json` requires. |
| Rocketbox avatars | Later | Could replace box passengers as static posed figures. Moving walkers would need a new animation system. |
| build123d | Fallback for sand3d | Mature and gives true rounded solids, but not built on Blender's Python. |
| Polyfork | No | Free tier requires their CDN and forbids re-hosting; the plan forbids runtime network requests. Flat-shaded look. |
| Blender MCP | No | No `.blend` files; generators run headless and the preview loop already closes the visual loop. |
| BatchedMesh per-instance opacity | No | The main app dropped BatchedMesh for buildings (see `src/systems/buildings.ts`). |
| vork, Tesseract | No | Offline renderers. vork has no fog or volumes. Possible marketing stills later. |
| Text-to-motion, Three-Live, model comparisons, self-hosted loop, pixel-art city, Dimension9 | No | Different projects or no need here. |

# Brief for the next session: two trials

Both are trials. The goal of each is a yes or no with evidence, not a migration. `AGENTS.md`
is binding: the verification loop, `npm run check`, `docs/DECISIONS.md`, `docs/NOTES.md`,
generator rules, never hand-edit generated files. The two tasks are independent; do task 1
first and commit it separately.

Stop and report after each task. Do not roll either change out past the scope given here.

## Task 1: surface detail on the monorail station and viaduct

**Problem.** `docs/NOTES.md` on the monorail: platforms "look like brown plastic", "big blank
viaduct planes", girders and piers near-black so their detail does not read. Some of these
lines were written about the slice in `next/`; check which still hold in the main app by
looking at `npm run shots:all` output before changing anything.

**What exists.** The facade shader (`src/materials/facade.ts`, `wallSample`) already samples
an 8-tile wall atlas (`art/external/textures/walls.webp`, cells in `walls.json`: three
concretes, tile, panels, two ribbed metals, slate) with luminance relief. Surface types are
in `art/style/facade.json` and written to `COLOR_0` by `art/generators/lib/surface.py`. The
ground (`src/materials/ground.ts`) is procedural noise with no image texture.

**Steps.**
1. Find which surface types the monorail assets use (`art/generators/props/monorail.py`,
   defs `art/defs/props/monorail_*.json`) and whether those types reach `wallSample`.
2. If the station and viaduct surfaces do not use the wall atlas, route them to a fitting
   existing tile first. That may be the whole fix, with no new texture.
3. Only if the existing tiles are not good enough, add Poly Haven CC0 sets (concrete for
   piers and girders, a floor or paving set for platforms). Fetch through
   `api.polyhaven.com`, at 1k or 2k. Record each file in `art/external/manifest.json` before
   use, add it to `art/textures/ktx2.def.json`, run `npm run textures`.
4. Leave the photographic tower facades alone, and paint no shader light over them (the
   human rejected that on 2026-11-03).

**Scope.** Monorail station, girders, piers and deck in the main app. Not the ground, not
buildings, not `next/`.

**Done when.** Before and after screenshots of the monorail viewpoints are in
`docs/progress/`, the critique is in `docs/NOTES.md`, and these hold: `npm run check`,
`npm run shots:all`, and `npm run perf` on an idle GPU, with programs still at most 25 and GPU
process memory under `scene.maxGpuProcessMB` (920 MB; the measured peak was about 797 MB, so
new textures have about 120 MB of room). Report draw calls, frame time and GPU memory before
and after.

## Task 2: sand3d trial on one rounded asset

**Problem.** `docs/NOTES.md`: cars are "planar facets", "low-poly game props from 2000", with
no rounding at bonnet, roof or wheel arches; the monorail nose shows its slices as a
staircase.

**What sand3d claims** (https://github.com/Sandflow-ai/sand3d, docs
https://sand3d.sandflow.ai/, Apache-2.0, v1.6.2, very young): a Python DSL over `bpy` with
profiles, solids, fillets and named parts, deterministic output, GLB export. Read its docs
before writing anything; do not write its API from memory.

**Steps, in the scratchpad first, not in the repo.**
1. Install: find out whether sand3d runs inside Blender 5.3's bundled Python 3.13 headless
   (`--background --factory-startup`). Install into a directory in the scratchpad and add it
   to `sys.path`; do not modify `/Applications/Blender.app`. If it cannot run there, stop and
   report: that is a valid result.
2. Build one asset with it: `vehicles/monorail_end` (current: 968 triangles, 26.5 KB) or one
   car (`vehicles/car_a`, 914 triangles). Match the current dimensions from the def.
3. Measure against the current asset:
   - triangle count against the vehicle budget (1,500 triangles, 64 KB in
     `pipeline.config.json`). Do not raise the budget for the trial; report what count the
     rounding needs;
   - whether the mesh can carry what the facade shader needs: surface codes in `COLOR_0`,
     metre-scale UVs, any custom `_NAME` attributes the current generator writes;
   - determinism: two runs give byte-identical GLBs;
   - coplanar faces (`npm run coplanar` logic) and shading normals after export.
4. Render both versions with the same preview cameras (`tools/blender/previews.py`) and
   compare side by side.

**Only if all of step 3 passes:** propose, in the report, how it would enter the pipeline
(vendored under `art/generators/lib/` or a pinned install step, since the cache key must
trace it and a fresh clone must build). Do not wire it into `npm run assets` in this trial.

**Done when.** A section in `docs/NOTES.md` gives the answers to step 3 with numbers, the
side-by-side images are in `docs/progress/`, and a line in `docs/DECISIONS.md` records
adopt, reject or fall back to build123d, with the reason. No generated file in `public/`
changes in this task.
