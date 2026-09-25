# Notes

Per-phase visual critiques (see docs/PLAN.md, section 1). Newest phase at the bottom.

## Phase 0 — Verify and adapt the template

Shots: `build/shots/district_a/` at `t=12`, 1280×720, SwiftShader. Layout is still the
template's `district_a` (5×5 grid, 3 tower variants); `city` arrives in phase 1.
Viewpoints are framed for `district_a`; the `fly-*` shots use fallback cameras
because no layout has a flythrough spline yet.

### Round 1 critique

- **Every emissive clips to near-white.** Windows are `tungsten`, `sign_amber`,
  `sign_cyan` and `sign_red` at emission strength 4, storefront strips at 6. After ACES
  they all land on the same cream white, so the new palette cannot be judged at all:
  tungsten, amber and cyan windows are indistinguishable in `canyon` and `rooftops`.
  The storefront strips read as fluorescent tubes rather than signs. Fix now: lower the
  strengths in the sample defs so hue survives tone mapping (bloom comes in phase 3).
- **The ground plane's edge is visible.** In `aerial` and `fly-75` the 3×-layout-sized plane
  shows as a lit diamond floating in the sky: fog (`haze`) is brighter than `sky`, so
  distant ground turns lighter than the background and its edge draws a hard line.
  It reads as a tech demo. Fix now: make the plane extend past the camera's far plane.
- **Facades are silhouettes.** Concrete is never visible; buildings are black cut-outs
  with lit rectangles. The hemisphere and moon lights are tinted blue-grey (`0x3a4a66`,
  `0x8fa6d8` literals), which contradicts the sodium/tungsten palette and does nothing at
  this exposure anyway. No depth layering from near to far except for fog on the ground.
  Phase 3 (sky, fog, post) and phase 2 (facade material).
- **Perfect grid, three buildings.** `aerial`, `fly-50`, `fly-75` and `horizon` show the same three
  towers repeated on a 5×5 grid with identical street widths. Windows align perfectly on
  every floor. Nothing about this is Mong Kok. Phase 1 (irregular layout) and phase 2
  (families and variants).
- **The bottom half of every street shot is void.** `canyon`, `storefront` and `fly-0`: the
  road is `road_wet` with no light on it, the sidewalk slabs are invisible, nothing
  reflects. The hero shot is currently the weakest in the set. Phase 4 (wet streets,
  lamp pools) and phase 5 (signs).
- **Legacy neon windows.** `sign_red` (remapped from `neon_magenta`) now shows up as salmon
  *window* light in `fly-25` and `rooftops`. Sign colors should never be interior light.
  Moot once phase 2 retires the sample towers; not worth a def change now.
- **No culling.** Triangles are ~348k in every shot, including `storefront`, which sees a
  fraction of the city. InstancedMesh bounds cover the whole layout, so nothing is ever culled.
  Budgets hold (≤46 calls, 2 programs), but this is the input to the phase 2
  BatchedMesh vs chunked-InstancedMesh decision.
- **Shimmer**: not judgeable yet; windows are modeled quads, and aerial is too dim to show
  moiré. Recheck once the shaded facade lands.

### Round 2 (after fixes)

- Emission 1.5 (windows) / 2.5 (signs) in the three sample defs: hues now separate:
  tungsten cream, amber, cyan and red are distinguishable in `canyon`, `rooftops` and `fly-75`.
  Tungsten still reads pale cream rather than warm; exposure and tone mapping are phase 3's
  job, not a def tweak.
- Ground plane is now 5 km, past the far plane: no diamond edge in `aerial`/`fly-75`;
  the horizon reads as a haze line in `horizon` and `rooftops`.
- `aerial` is now a small, murky city in a field of brown haze: the city is only 232 m across
  and the fog-lit ground fills the frame. The framing is right for the phase 1 city; the
  haze/ground brightness relationship is for phase 3.
- Remaining for later phases (unchanged): silhouette facades, blue-tinted template lights,
  grid regularity, empty street level, no culling. `canyon` is still the weakest shot and
  should become the strongest by phase 5.

## Phase 1 — Layout

Plan view: `node tools/debug/plan.mjs` → `build/debug/city-plan.png` (roads, districts,
footprints shaded by height, fronts, lamps, flythrough). Placeholder buildings are still
the template towers.

### Round 1 critique (plan view)
- Road net looked like shattered glass: every cut took a random angle, so blocks were
  triangles and long diagonals. Irregular, but not a city anyone lives in. Fixed: cuts follow
  a per-district grid angle (core 8°, towers 30°, industrial −6°) with a few degrees of jitter,
  and only the first arterial may run diagonally.
- Too many arterials (26 m roads everywhere). Fixed: arterial superblocks 90k → 150k m².
- The hero street ran along the port edge, half in the industrial district. Fixed: the hero
  superblock is weighted by the fraction of its area that is old core.

### Round 2 critique (shots)
- `canyon` already has the right bones: a ~600 m straight street, walls on both sides, the
  tower cluster closing the far end of the view. It is still black-on-black with the
  placeholders' red sign strips as the only accent.
- `aerial` was drowned in fog (density 0.0022 was tuned for the 232 m template grid); halved
  to 0.0011 until phase 2's height fog. Now the tower cluster, core grid, arterials and the
  sparse industrial edge all read. Still: a hard horizon band where fog-lit ground meets the
  darker sky, and the core looks like dotted boxes with courtyards — blocks are only
  perimeter-built, because the placeholders are 10–14 m deep. Phase 2 slabs should be
  deeper and the interior fill denser.
- `fly-25`/`fly-50` looked away from the city along the path tangent. Fixed: the flythrough
  carries a look-at track (one target per control point).
- The flythrough climbs almost vertically at the canyon's end, because the hero street ends
  at the tower cluster (the clearance rule lifts it to ~420 m). Phase 5 should thread it
  between the towers instead of over them.
- **Budget miss:** ~4.1M triangles in every view (budget 3M), all from 1,500 placeholder
  towers with modeled windows and no culling. Phase 2 replaces them (shaded windows) and
  adds BatchedMesh culling; re-check there.

## Phase 2 — Canyon slice

Families (`node tools/debug/sheet.mjs 'buildings/*'`): 8 old slabs, 4 mid-rise/industrial,
4 setback towers, plus a street lamp. All facade-shaded, 130–1,330 triangles each.

### Round 1 — first facade-shader shots
- Walls glowed orange-brown: hemisphere light 0.9 plus lamp spill; the night was a dusk.
  Ambient cut to 0.3, spill reduced.
- Storefront interiors were blocky noise (JPEG-artifact look); canopy soffits were grey
  slabs with harsh tubes. Rewritten: racks, counter band, strip light, colored goods; tubes
  dimmer and broken into fittings.
- Towers read as beige zebra stripes: curtain walls borrowed the concrete base, and whole
  floors switched off together.

### Round 2
- Facades still glowed beige: my anti-aliasing faded windows to a per-cell average while a
  cell was still ~16 px wide, lighting whole cells as blocks. Thresholds now keep windows
  sharp down to ~2 px, then fade per cell, per floor (rows survive as bands on towers), then
  per facade.
- Towers now 30% of the residential lit ratio with floors on/off in runs: `fly-50` finally
  reads as office towers at 2 a.m.
- Far ground hazed out fully with a thin uniform fog floor; horizon still shows a darker
  ground/brighter sky band from above (realistic, keep).

### Round 3 — reflections and signs
- First reflection was a flooded canal: sideways noise wobble reads as water. Now mostly
  vertical jitter and smear, grainy dull film, clean only in puddles.
- Signs were pale pink/white (tube cores too hot for AgX) and timid (1–3 m blades). Now
  saturated cores, blades up to 3.2 m and "arms" up to 7.5 m over the street, 2–5 per hero
  building. Backlit boxes were blank white boards: now colored faces with light characters,
  or pale faces with saturated characters. Cyan halved.
- Bugs found and fixed: sky black from above (dome matrix lagged after the reflection pass
  moved it); mottled ground from sub-pixel puddle noise (now fades to its mean).

### Where it stands (checkpoint 1)
- `canyon` is the strongest shot: stacked signs from both sides, red neon, shopfronts,
  sodium lamps, streaks in the wet asphalt, towers closing the vista. `storefront` and
  `fly-0` share its read.
- Remaining weaknesses, harshly:
  - Walls are still one flat brown-grey plane between windows. No stains, no tiles, no
    per-floor variation beyond grime noise. Concrete reads as cardboard up close.
  - Windows are all the same size and position per cell; no mullions, no curtains' color, no
    visible interiors. The slab fronts look stamped.
  - Signs have no brackets or frames (boxes float a few cm off the wall), no light spill
    onto the facades or the street next to them, and the reflection of a sign is the only
    color on the ground.
  - Street level is empty: no props, no haze, no rain, no traffic. The road between the
    lamps is black.
  - Tower crowns (the lit fixture band) are too bright and too uniform: every tower wears
    the same white ring (`fly-25`).
  - `aerial`: towers still slightly beige when windows average out; the core reads well.
  - Shimmer cannot be judged from static SwiftShader stills; the facade shader fades
    detail by pixel footprint, but it needs a look in motion (`npm run dev`, orbit).
  - Flythrough climbs vertically at the canyon's end; masts pass close to the camera
    (`fly-25`). Phase 5.

## Human review — checkpoint 1 (given in chat, 2026-09-25)
- All looks great, especially ground level: wet roads and storefronts "look incredible".
- Biggest weakness: buildings. They lack proper materials, are totally flat, and windows
  don't read as emissive/real windows.
- Towers look uniform: every one has the same ring on top.
- Priority: better building materials/textures and more variety.

## Building pass (after checkpoint 1, before phase 3)

Addresses the checkpoint 1 review: flat buildings, windows not reading as lit windows,
identical towers.

### What changed
- Towers and mid-rise office bodies: photographic facades from the human's High-Rise Atlas v1
  bundles (21 facades), mapped at real floor height, offset per building by whole bays and
  floors, with emissive interiors, normals and sky reflection in the glass. Eight tower
  variants with six crown types; only two keep a lit band.
- Residential/office windows: interior-mapped rooms (tinted walls, furniture, ceiling lamp,
  parallax), frames with mullion and transom, recess shadow, blinds and curtains.
- Walls: image materials (mosaic tile, concretes, panels, ribbed metal, slate) with
  luminance relief, faded paint on ~45% of old slabs (new palette names), floor bands,
  pilasters, grime streaks.
- Sign light: a colored top-down sign map lights facades up to sign height and the wet
  ground below. This is what finally makes the wall materials visible at night.
- Slabs: floor ledges, bay-window runs, stepped tops; 12 slab variants (was 8).
- New viewpoint `facade`: close detail of a hero-street slab.

### Critique rounds
1. Materials were invisible: nothing lit the walls. Sign spill fixed it, then overdid it
   (walls near signs read like dusk); spill cut to ~40% and fades above ~14 m.
2. Photographic albedo is daylight-bright; walls scaled down so they only show where light
   reaches them.
3. Moiré from cage bars, blinds and curtain folds at mid distance; each now fades to its
   average coverage before aliasing.

### Remaining (harsh)
- Rooms behind lit windows are still a bit bright and similar; no people, no clutter.
- Paint and tile are chosen per building but uniform over the whole building; real slabs
  have patched, repainted, differently tiled floors.
- Towers repeat a facade texture on all four sides; corners don't wrap.
- `rooftops` is very dark: roofs get almost no light; rooftop clutter barely reads.
- The Osaka bundle uses its emissive B map (A is a truncated PNG in the source folder).
