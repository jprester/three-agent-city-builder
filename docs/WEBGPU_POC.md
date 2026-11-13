# WebGPU proof of concept

Branch `webgpu-poc`, 2026-11-13. The question: is it worth moving the city from
`WebGLRenderer` with patched GLSL to three's `WebGPURenderer` with node materials (TSL)?

The proof of concept is a second page, `poc.html` → `src/poc/`. The app (`index.html`,
`src/main.ts`) is untouched, so both run from the same checkout and the same test harness.

    npm run dev                      # then open /poc.html?viewpoint=canyon
    APP=poc npm run shots:all        # screenshots in build/shots/poc-city/
    APP=poc npm run smoke
    APP=poc npm run perf             # WebGPU
    PERF_SYNC=1 npm run perf         # the app, measured the comparable way (see below)

`/poc.html` takes the app's URL parameters, plus `?backend=webgl` (same node materials on
three's WebGL 2 backend), `?rain=<n>` (rain count as a multiple of the preset; 0 = off) and
`?haze=0`.

## Verdict

- **It works.** All 20 viewpoints render with no browser errors, on WebGPU and on the WebGL 2
  fallback, at the same draw calls and triangles as the app.
- **It is not faster.** Frame cost is equal within the run-to-run noise of about 1 ms.
- **It can do things the app cannot.** The rain is a compute-shader simulation with roof
  collisions and splashes, at twice the drop count, for no measurable cost.
- **A full port is mostly one file.** Everything except the facade shader is ported in full.
  The facade material is the remaining work and the main risk.

Recommendation: do not port for performance. Port only if a planned feature needs compute
shaders (GPU traffic or crowds, particles that interact with the city) or the 25-program
limit starts to block material work.

## Measurements

1440×900 @2x, high quality, Apple GPU (Metal), idle machine. Median milliseconds from the
start of a frame until the GPU has finished it, CPU included ("submit-to-done").

| Viewpoint  | App (WebGL) | PoC (WebGPU) | PoC on WebGL 2 backend |
|------------|-------------|--------------|------------------------|
| canyon     | 12.2        | 10.9         | 12.5                   |
| storefront | 12.0        | 10.9         | 12.5                   |
| aerial     | 12.4        | 11.0         | 11.6                   |
| harbor     | 11.1        | 10.7         | 11.0                   |
| fly-75     | 13.1        | 12.1         | 10.8                   |

A second WebGPU run gave 10.8, 12.2, 12.9, 10.0 and 11.3, so differences under about 1 ms are
noise. The comparison also flatters the proof of concept slightly on the facades (reduced
shader, see below) and penalises it on rain (twice the drops) and bloom (a heavier chain).

Other numbers:

- **GPU time, same instrument.** With a WebGL timer query the app takes 8.2–10.6 ms and the
  proof of concept on the WebGL 2 backend 10.3–11.9 ms. Generated node shaders cost about
  1.5–2 ms more GPU time here than the hand-written ones.
- **GPU memory.** The GPU process holds 1.23–1.33 GB for the proof of concept and about
  1.76 GB for the app, on either backend. That is what the proof of concept does not load
  (tower normal maps, the glass cube capture, the PMREM environment), not a saving from WebGPU.
- **JS heap.** 195–225 MB against 70–80 MB. The tower texture arrays keep their CPU copy
  (about 100 MB); a port should release it after upload.
- **Bundle.** The WebGPU page adds an 824 kB chunk (257 kB gzip) for the renderer and TSL.
- **Scene.** Peak 225 draw calls and 1.68 M triangles (app: 230 and 1.64 M; the difference is
  rain and the skipped environment captures).

### How the time is measured

WebGPU timestamp queries are not usable on this machine: the per-pass times three resolves
add up to 50–100 ms for a frame that holds 60 fps. Turning vsync off does not help either;
animation frames then run ahead of the GPU. `tests/perf/perf.spec.ts` therefore records
submit-to-done: for WebGPU the `onSubmittedWorkDone()` promise of the device queue, for
WebGL a blocking one-pixel read-back at the end of the frame (`PERF_SYNC=1`, because it
changes the frame). Both include the CPU time of the frame.

## What is ported

| Part | File | State |
|------|------|-------|
| Sky dome, clouds, ridges, distant lights, lightning | `src/poc/sky.ts` | Full |
| Height fog | `src/poc/tsl.ts` | Full, as a scene fog node |
| Ground, water, puddles, ripples, car lights, mainland lights | `src/poc/ground.ts` | Full |
| Planar reflection | `src/poc/reflection.ts` | Full |
| Sign boxes, holograms, wordmarks | `src/poc/signs.ts` | Full, including the part-id decode |
| City haze, bloom, AgX, night grade, vignette, grain, SMAA | `src/poc/post.ts` | Full except chromatic aberration |
| Rain | `src/poc/rain.ts` | Replaced by a compute simulation |
| Facades | `src/poc/facade.ts` | Reduced, see below |
| Layout, instancing, LOD, vehicles, cameras, sign data, light maps | shared with the app | Unchanged |

Not in the proof of concept: the debug GUI, audio, dynamic resolution, the two environment
captures (PMREM for rough metal, the cube for tower glass).

### The facade material

Kept: surface types, facade meters with instance-scale compensation, wall materials, the
photographic tower atlas with per-floor lighting, window grids with three distance tiers,
interior-mapped room cards, storefronts, fixtures and signals, screens, car paint, and the
lamp, sign and canyon light on walls.

Dropped: window families and mullions, blinds and curtains, neighbour spill, the glass
environment reflection, normal relief from wall and tower textures, parked cars in the
car-park decks. The visible cost is flatter tile walls up close and duller tower glass.

## What we learned

1. **Shared code survives.** `buildInstances`, the LOD system, `createSigns`,
   `createStreets`, the light maps and the cameras run unchanged; the proof of concept swaps
   their materials. `three` and `three/webgpu` share one core, so classes mix freely.
2. **Render-target textures are addressed top-down** by three on both backends. A lookup
   matrix that yields v up (the planar reflection) needs `1 - v`. This cost the most time.
3. **Clip space differs.** Depth runs 0..1, so the oblique near plane of the reflection is
   scaled and stored differently (see `reflection.ts`; three's `ReflectorNode` does the same).
4. **Seeds must be computed in the shader.** `sin()` of a large argument turns a double
   versus single precision difference into a different building. With the multiply moved into
   the shader, every building matches the app.
5. **One evaluation, several outputs.** A material's colour, emissive, roughness and
   metalness come from one function through shared `property()` nodes written while the
   colour node builds.
6. **Per-instance data in a shared material** comes from
   `referenceAttribute('instanceMatrix', 'mat4')`. Non-instanced meshes that use the material
   (the bridges) become one-instance meshes.
7. **Array textures need CPU data.** The WebGL loader's raw `texSubImage3D` upload has no
   equivalent, so the layers are decoded with WebCodecs' `ImageDecoder` (a 2D canvas would
   premultiply and damage RGB under the roughness in alpha). Chromium only for now.
8. **TSL types fight shader code.** `src/poc/tsl.ts` re-exports TSL untyped. A real port
   should keep the types and pay for the casts.
9. **The program budget does not carry over.** WebGPU reports 39 shader modules, counted
   differently and with no hard limit behind it; the tests skip that budget for `APP=poc`.
10. **Compute also runs on the WebGL 2 fallback** (three emulates it with transform
    feedback), so the rain did not need a second code path.

## If we port

1. Facade material in full: window families, spill, relief, glass reflection (most of the
   1,021 lines; the structure in `src/poc/facade.ts` holds).
2. Environment captures with the WebGPU `PMREMGenerator` and a cube render target.
3. Dynamic resolution, debug GUI and audio (renderer-independent, just not wired up).
4. Typed TSL, and release of the CPU copies of the texture arrays.
5. A fallback for `ImageDecoder` in Firefox and Safari.
6. Re-tune bloom against the app (the node bloom is the Unreal chain, not the mip blur).
