# Fresh slice

A new, small night city built from nothing in the order the retrospective on the main app
recommends, to see what that order buys. It lives beside the app and shares only three things
with it: the palette (`art/style/palette.json`), the sign vocabulary, fonts and typesetting code
(`art/signs/`, `tools/textures/build_sign_designs.py`) and the seeded random helper. Its sign atlas is
its own (`next/assets/`, `npm run next:signs`).

    npm run next:dev        # opens http://localhost:5183/ (not the main app's port 5173)
    npm run next:shots      # every viewpoint: screenshots, budgets, frame time, GPU memory
    npm run next:build
    npm run next:signs      # rebuilds next/assets/signs.png + .json (Python 3, Pillow, numpy)

The page opens on a flyover: a 90 s loop along the monorail, out on one side of the street and
back on the other. `F` returns to it; keys `1`-`7` jump to the fixed views, which you can orbit.

URL parameters: `?view=flyover|corner|under|line|platform|deck|above|skyline`, `?cam=x,y,z,tx,ty,tz` (any fixed camera, for close inspection), `?t=<seconds>` (freeze the
clock), `?seed=<int>`, `?rain=<count>` (0 = off). WebGPU only (Chromium).

## What it is

The same footprint as the main app (1000 × 800 m): one main street with a suspended monorail and a
station over its median, ten cross streets, six back streets, about 1,000 buildings on their lots
and 1,800 more out to the horizon. Trains run and
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
   and lots, then places buildings. The monorail, the station, the pedestrian deck and the
   skybridges are part of the plan, not additions: lamps, stairs, stop lines and the rain's
   height map all come from the same data.
4. **Three distance tiers, deliberately.** Every building, street to horizon, is one mesh of
   bare walls and one material that picks the tier per pixel: a recessed window with a room
   behind it, then one light per window, then the facade's mean. The near tier adds the kit:
   about 6,000 boxes (balconies, AC units, awnings, pipes, parapets, tanks, lamps, the
   whole monorail) in one instanced draw.
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

- Floors under the tubes are lit and the ceilings stay dark, which gives the covered
  sidewalk and the platform some shape. Unlit stretches remain dark, and the flat concrete
  needs surface detail.
- The kit is honest but crude: cars and trains are boxes, the station is frames and slabs,
  stairs are solid blocks.
- Glass towers light in a regular tenant pattern that reads as a barcode from above.
- Shop interiors are one procedural room with noise for goods; up close it is the weakest
  surface in the frame.
- `corner` now looks from the cross-street approach: the crossing and reflected light lead
  into the canyon. The left corner building still dominates, but its base is visible.

## Fixture light (2026-11-13, reworked 2026-11-14)

The fluorescent tubes under the viaduct, the deck, the canopies and the bridges register
their positions in a third top-down map (`lightmaps.ts`), split into three layers by mounting
height, one per colour channel. The materials turn that into light per pixel (`fixtureSpill`
in `tsl.ts`):

- a layer lights nothing above its own height, so the top of a deck is not lit from below;
- the pool is read at a coarser mip the further the surface is below the fixtures, so it
  spreads and thins with distance;
- floors take the light fully, walls half, ceilings a tenth.

Three samples of one texture per lit pixel; no lights, draw calls or triangles. It still
cannot see slabs in between: canopy light reaches the road under the viaduct, weakened by the
14 m drop. The first version (irradiance baked at 0, 8 and 16 m) lit every surface evenly and
flattened the frame; images of it are in `docs/progress/fresh-slice-lighting/`, of this one in
`docs/progress/fresh-slice-spill/`.

The `corner` camera stands at the cross-street approach, so the crossing and the wet road
lead into the canyon.

Gate on 2026-11-14: 32 calls, 259,355 triangles, GPU process about 575 MB. Median frame
6.7–10.4 ms over three runs, against 6.0–7.3 ms for the first version in one run. Runs differ
by about 1.5 ms on this machine, so the two extra samples cost somewhere between nothing and
1 ms; both are far inside the 16.7 ms budget.

## Monorail (2026-11-14)

The railway is a suspended monorail in the Chiba style, as the human asked: one straight line
down the main street, no curves or branches.

- **Track:** two box girders at 11.7 m, one per direction, on T-shaped piers in the median
  every 30 m (none in the junctions). A cool light line runs under each girder, a lit collar
  round each pier, red beacons on the arms.
- **Trains:** three cars hanging from the girder by their bogie struts, white hull, a dark
  window band with lit panes, a cyan line along the skirt, tapered ends with a lamp bar. Same
  timetable as before: one train per direction, half a cycle apart, a 12 s stop.
- **Station:** side platforms slung at car-floor height (8 m) under a roof on five portal
  frames that stand on the sidewalks and span the street. Glass screens with a lit rail at the
  platform edge, a glass balustrade at the back, suspended tubes that light the floor.
- **Access:** the pedestrian deck (5.6 m) and a short flight up to the north platform; one
  long flight from the sidewalk to the south platform.

`plan.ts` holds it as `monorail`; `build.ts` and `train.ts` build it from boxes, so it is the
right silhouette and still a blockout. New viewpoint: `line`, along the track from the street.
Images in `docs/progress/fresh-slice-monorail/`.

Gate on 2026-11-14: 7/7 viewpoints, 32 calls, 261,203 triangles, GPU process about 580 MB.
Frame time could not be judged in that session: another Chrome was using the GPU, and both
this commit and the one before it read 12–16 ms where an idle machine gave 7–9 ms.

Next: the cars have no door openings or interior, the south stair is a solid ramp of blocks,
piers and girders are plain boxes with no joints. Then vehicles on the road, the tower
barcode and the shop interiors.

## Monorail detail (2026-11-14)

Task 1 of `next/PLAN.md`. Images in `docs/progress/fresh-slice-monorail-detail/` (the gate's eight views and five
close-ups taken with `?cam=`).

- **Cars** (`train.ts`): the body is now built around real openings. Skirt and roof band are solid, and the window band
  is piers with gaps, so the lit interior shows through: a ceiling panel with two light strips, a lining behind each
  pier, seat backs along both walls, grab rails, end walls with a gangway door, bellows between cars, and 3–8 passengers
  per car as dark silhouettes (seeded). Two doors per side per car: the leaf sits 12 cm back in the wall, with two
  lit panes, a centre seam, a lit threshold and an amber lamp over it. Hangers are a roof fairing, a plate up into a
  dark slot under the girder, and two raked links. The nose is 16 slices on a curve that turns into a straight rake,
  with a raked windscreen over it, a chin panel, an amber destination display at the head of the screen, and
  lamps on the lower front.
- **Girders and piers** (`build.ts`): stiffener ribs every 7.5 m, a joint beside each arm, side plates and a bearing
  pad where the girder hangs from the arm, knee braces from shaft to arm, a cable tray and a walkway rail with posts
  on top, a footing, a cap and an access door on each plinth. The light line under each girder stays.
- **Station**: every stair is now an open stair (`openStair`): separate treads on two stringers, rails on posts, and
  a landing on two columns wherever a flight would rise more than 4 m. The south stairs have a landing halfway and a
  railed bridge across to the platform; the north flights and the deck's end stairs use the same builder. The deck is
  notched round the portal legs, with a kerb round each notch. The balustrades and the deck rail open where a stair
  arrives. Platform screens now break at the six door positions, with queue lines on the floor, a lit threshold and a
  door lamp at each. New: a name board facing the track and two hanging along each platform, a timetable case, an
  octagonal clock, a red drinks machine beside the navy one, recycling bins, bench legs.
- **Light on the train**: a line of tubes under a fascia over each track edge, at the platform lights' height so it
  joins their fixture layer. It lights the side of a standing train, the screens and the platform edge. No new layer,
  light or draw call.
- `platform` now stands on the south platform, where the train is at `t=20`, so the gate looks at the lit side.
- Dimensions (car, doors, girder, stairs) are in `plan.ts` (`monorail.car`, `monorail.doorXs`, `monorail.girder`, `stair`).

Gate on 2026-11-14: 8/8 viewpoints, 32 calls (unchanged), 302,099 triangles (+40,896 against 261,203; the
budget for this task was 60,000), GPU process 575–581 MB. Median frame 6.7–11.5 ms. Another Chrome tab had the slice
open on the same GPU during the run, so these figures are not comparable with an idle machine.

Still weak: the station name is made-up stroke glyphs that read as pseudo-Latin; the platform screens are opaque
dark-teal slabs; the girders are near-black at night, so their ribs and joints barely show from the street; the
doors do not open during the dwell; the passengers are two boxes each.

## Road vehicles (2026-11-14)

Task 2 of `next/PLAN.md`. Images in `docs/progress/fresh-slice-vehicles/`.

- Four body types from one part scheme (`src/vehicles.ts`): sedan (40 %), kei car (25 %), delivery van (15 %), taxi (20 %).
  Each body is a few side profiles extruded across the car, so the windscreen and rear window slope. Parts on top:
  pillars, roof skin, dark wheel arches, octagonal wheels with hubs, mirrors, bumpers, grille, front and rear plates,
  and lamps shaped per type (wide and slim on the sedan, square on the kei car, tall tail lamps on the kei car and the
  van). The taxi adds a lit roof sign, a red vacancy lamp behind the screen and a cream stripe. The van has a short cab,
  a tall box with small side windows and a sliding-door seam.
- The type comes from the car's seed when the buffer is filled; the paint comes from a different hash of the same seed,
  out of a per-type list (taxis in taxi colours, vans in fleet white and grey). The glass shows a dim warm interior,
  brighter in about one car in five with the dome light on.
- The simulation and the storage buffers are unchanged. Each body type is its own instanced draw that reads its cars
  through a small list of indices. Brake lights still come from the simulation. Lamps emit only from their front and
  back faces, so a car seen from above does not bloom.

Gate on 2026-11-14: 8/8 viewpoints, 38 calls (+6: three more types, in the main pass and the reflection), 383,163
triangles (+81,064, about 390 per car per pass), GPU process 575–589 MB, median frame 6.9–8.8 ms (the dev-server tab
was still open).

Still weak: there are no rounded forms at all, so up close every car is facets; the glass is one opaque dark block
with no visible occupants; the wheels never turn; every car of a type is the same length, and the simulation still
spaces all of them as 4.4 m cars.

## Signs (2026-11-14)

The human reported signs set on windows and through balconies, and boards far too big for their text.
Images in `docs/progress/fresh-slice-signs/` (`atlas.jpg` is the whole atlas).

- **Atlas sized to the text.** The app's atlas has four fixed slot sizes, so one character sat in a frame made
  for four. `next/tools/build_signs.py` reuses the app's typesetting, fonts and vocabulary but measures each
  design and gives it a slot that fits, then packs the slots on shelves (`next/assets/signs.png`, 4096×2048,
  148 designs). The sign shader is unchanged.
- **New kinds, after the human's reference photos:** multi-floor LED towers with a bulb border (some with a
  clock), shop fascias across a whole frontage, and channel letters on rooftop frames (brand names on the
  taller buildings, the way crown signs read from a distance).
- **Placement** (`build.ts`):
  - Blades and towers hang on the piers between window bays, never across a window.
  - The bays beside them keep no balconies or AC units on the floors they span.
  - Blades get an arm every 2.5 m.
  - Signs over the pedestrian deck start 3 m above it.
  - Every shopfront has a signboard band, with its sign on it; 40 % of frontages get one fascia instead.
  - A design is not repeated within the last eight picks of its kind.
  - Signs above 30 m no longer add to the street's sign light map.

Gate: 8/8, 38 calls, 396,843 triangles (+13,680, the signboard bands and arms), GPU process 577–586 MB.

Still weak: dead characters on a pale lightbox read as dark gaps rather than as unlit tubes; nothing
animates (no LED chase on the towers); the channel letters have no visible returns or side depth; all
signs are flat cards, with no box depth on the lightboxes.

## Full size (2026-11-14)

The city now covers the main app's footprint, 1000 × 800 m, after the human's concept art: dense housing
of ten to twenty-five floors everywhere, the low old core along the monorail, and a high-rise district at
the east end of the main street. Images in `docs/progress/fresh-slice-full-size/`.

- **Plan:**
  - Cross streets every 100 m (ten in all) and three back streets either side of the main street.
  - Traffic on all of them: 88 cars on the main street, 60 on the back streets, 100 on the cross streets.
    Signals now take up to twelve stop lines per lane.
  - The monorail is the same single straight line, now 1,040 m long. The train runs take 24 s, and a full cycle 84 s.
  - Balconies, AC units and signs are built as geometry only on the main street and within 170 × 110 m of
    the station. Further out, the facade shader draws the detail.
  - The far ring has 1,800 buildings spread evenly by area up to the city's edge: mid-rise housing near it,
    towers further out.
- **What scaling needed** (where the advantages would have broken):
  - The kit is no longer one draw. It is one instanced mesh per 250 m chunk: the renderer skips chunks outside
    the view, and the code hides those further than 420 m (200 m in the road reflection). Lit parts and long
    parts stay in one always-drawn mesh, so lamps and aviation lights still dot the far city.
  - Cars got cheaper: one tyre prism and hub plate per axle, one mirror bar.
- **Gate:** 8/8, 50–54 calls, 560–587k triangles (`skyline` 38 calls, 341k), median frame 7.1–10.8 ms,
  GPU process 643–659 MB. The main app at this size: up to 230 calls, 1.64 M triangles, 11–13 ms, about 1.76 GB.

Still weak:
- Beyond about 2 km the fogged ground shows as a dark band below the hills.
- The far facades show the pale tenant mosaic (the barcode) across the whole city.
- Housing away from the main street has no AC units or balconies at all: the shader version is not done.
- Triangles sit near the 600k budget, mostly from cars drawn twice.

## Files

| File | Role |
|---|---|
| `src/plan.ts` | Roads, blocks, lots, buildings, monorail, deck, bridges, lanes, signals |
| `src/build.ts` | Plan to geometry: the building shell, the box kit, the signs |
| `src/facade.ts` | The facade material with its three tiers; the kit material |
| `src/lightmaps.ts` | Top-down lamp/sign maps and height-sampled fixture spill |
| `src/ground.ts`, `src/reflection.ts` | Wet road and its planar reflection |
| `src/signs.ts` | Sign material and atlas loading |
| `tools/build_signs.py`, `signs.def.json`, `assets/` | The slice's sign atlas, every board sized to its text |
| `src/traffic.ts`, `src/train.ts`, `src/rain.ts` | Motion; traffic and rain are compute passes |
| `src/vehicles.ts` | Road vehicle body types (sedan, kei car, van, taxi) from one part scheme |
| `src/sky.ts`, `src/post.ts` | Sky dome; haze, bloom, tone mapping, grade, anti-aliasing |
| `src/tsl.ts` | Palette and shared shader helpers |
| `tests/slice.spec.ts`, `budgets.json` | The gate |
