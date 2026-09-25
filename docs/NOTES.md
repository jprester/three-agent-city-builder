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
