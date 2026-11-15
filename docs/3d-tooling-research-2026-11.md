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
