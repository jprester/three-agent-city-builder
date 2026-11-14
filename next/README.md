# Fresh slice

A new, small night city built from nothing in the order the retrospective on the main app
recommends, to see what that order buys. It lives beside the app and shares only three things
with it: the palette (`art/style/palette.json`), the typeset sign atlas
(`art/textures/signs/`) and the seeded random helper.

    npm run next:dev        # http://localhost:5183/?view=corner
    npm run next:shots      # every viewpoint: screenshots, budgets, frame time, GPU memory
    npm run next:build

URL parameters: `?view=corner|under|platform|deck|above|skyline`, `?t=<seconds>` (freeze the
clock), `?seed=<int>`, `?rain=<count>` (0 = off). WebGPU only (Chromium).

## What it is

One main street with an elevated railway and a station over its median, four cross streets,
two back streets, 170 buildings around them and 520 more out to the horizon. Trains run and
stop, cars queue at signals, rain falls and splashes, signs flicker. About 2,000 lines.

Measured at 1440×900 @2x on the Apple GPU (`npm run next:shots`, 2026-11-13):

| | Slice | Main app |
|---|---|---|
| Draw calls | 32 | up to 230 |
| Triangles | 0.26 M | up to 1.64 M |
| Frame (start to GPU done) | 6.7–8.5 ms | 11–13 ms |
| GPU process memory | about 560 MB | about 1.76 GB |

The two are not the same scene. The app has photographic tower facades, modelled buildings,
pedestrians, room interiors rendered in Blender and more signs. The numbers show what the
structure costs, not that the slice looks as good.

## The seven points, and what was done about each

1. **One finished frame first.** `corner` was the target: wet street, viaduct, station deck,
   shopfronts, signs, traffic, rain, grade. Everything was built to serve it, then checked
   from five other viewpoints. Not there yet, see the critique below.
2. **WebGPU and node materials from the start.** `WebGPURenderer`, every material in TSL
   (`src/facade.ts`, `ground.ts`, `signs.ts`, `sky.ts`), post-processing as nodes
   (`post.ts`), and two compute passes (`traffic.ts`, `rain.ts`).
3. **Streets first, with vertical layers.** `src/plan.ts` starts from the roads, cuts blocks
   and lots, then places buildings. The railway, the station, the pedestrian deck and the
   skybridges are part of the plan, not additions: lamps, stairs, stop lines and the rain's
   height map all come from the same data.
4. **Three distance tiers, deliberately.** Every building, street to horizon, is one mesh of
   bare walls and one material that picks the tier per pixel: a recessed window with a room
   behind it, then one light per window, then the facade's mean. The near tier adds the kit:
   5,900 boxes (balconies, AC units, awnings, pipes, parapets, tanks, lamps, the whole
   railway) in one instanced draw.
5. **Fake the lighting.** No light objects for anything practical. Lamps and signs are drawn
   once into two top-down maps (`lightmaps.ts`) that the ground, walls, kit, cars, rain and
   haze all read. Windows, signs and lamps are emission with bloom; the wet road is a
   quarter-resolution planar reflection; fog is exponential in height. No shadows.
6. **Signage as a system.** The typeset atlas from the main app (real fonts, trade words) with
   its channel packing, on boards over the shopfronts, blades on arms and rooftop boards,
   placed by the same loop that places the kit.
7. **Motion early.** Trains with a station stop (`train.ts`), 104 cars that follow each
   other and obey a signal cycle entirely on the GPU, 30,000 rain drops that stop on roofs,
   the viaduct and the canopies, blinking aircraft lights, flickering signs.

## What was not done

- **KTX2 texture arrays.** There is one texture in the slice (the sign atlas, PNG). The
  recommendation stands for a project with photographic textures; nothing here needed it.
- **Headless Blender.** All geometry is built in TypeScript from boxes. That is why it is
  fast to change and why it looks like boxes.
- **Generated art.** No posters or facade photographs; the facades are fully procedural.
- **WebGL 2 fallback.** Not tested. The traffic compute reads its neighbour's state from the
  buffer it writes, which the transform-feedback fallback may not allow.
- **Pedestrians, audio, a debug panel, dynamic resolution, typed TSL.**

## Critique

- Covered sidewalks and the viaduct now receive soft fluorescent spill from the existing
  fixtures. Unlit stretches remain dark; the flat concrete needs surface detail next.
- The kit is honest but crude: cars and trains are boxes, the station has no detail at eye
  level, stairs are solid blocks.
- Glass towers light in a regular tenant pattern that reads as a barcode from above.
- Shop interiors are one procedural room with noise for goods; up close it is the weakest
  surface in the frame.
- `corner` now looks from the cross-street approach: the crossing and reflected light lead
  into the canyon. The left corner building still dominates, but its base is visible.

## Continuation — lighting and corner composition (2026-11-13)

The existing fluorescent tubes now register their positions with a third light map. Its RGB
channels hold irradiance at 0, 8 and 16 m; ground, facades and kit interpolate by height. Long
fixtures contribute along their length. This adds one texture sample per receiving material,
no lights, draw calls or triangles. It is soft spill without occlusion, so some light can leak
through decks. The sky lighting, exposure and colour grade remain as before.

The corner camera moved to the cross-street approach at eye height. Checked all six viewpoints,
frozen and running, against the style bible. Progress images and measurements are in
`docs/progress/fresh-slice-lighting/`; the original blockout images remain in `fresh-slice/`.

Final gate: 32 calls, 259,355 triangles, median frame 6.7–8.2 ms, GPU process 566–578 MB.
`npm run check`, all 97 unit tests and `npm run next:build` also pass.

Next: model the station/viaduct kit (open railings, stair supports, platform furniture), then
vehicles. Lighting exposes these placeholders more clearly; this is still not a finished hero
frame. The tower barcode and repeated shop interiors remain open after that.

## Files

| File | Role |
|---|---|
| `src/plan.ts` | Roads, blocks, lots, buildings, railway, deck, bridges, lanes, signals |
| `src/build.ts` | Plan to geometry: the building shell, the box kit, the signs |
| `src/facade.ts` | The facade material with its three tiers; the kit material |
| `src/lightmaps.ts` | Top-down lamp/sign maps and height-sampled fixture spill |
| `src/ground.ts`, `src/reflection.ts` | Wet road and its planar reflection |
| `src/signs.ts` | Sign material and atlas loading |
| `src/traffic.ts`, `src/train.ts`, `src/rain.ts` | Motion; traffic and rain are compute passes |
| `src/sky.ts`, `src/post.ts` | Sky dome; haze, bloom, tone mapping, grade, anti-aliasing |
| `src/tsl.ts` | Palette and shared shader helpers |
| `tests/slice.spec.ts`, `budgets.json` | The gate |
