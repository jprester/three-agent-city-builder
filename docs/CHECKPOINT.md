# Checkpoint 1 — layout, facade shader, canyon slice

Phases 0–2 (revised order, PLAN §8b). Shots: `docs/progress/phase-2/` (also
`build/shots/city/`), 1280×720, `t=12`. No baselines exist yet; approve them if you like
what you see (`npm run shots:approve`).

## What changed
- **Layout** (`art/layouts/city.mjs`): 1000×800 m city from grid-following recursive splits:
  arterials, secondary streets, alleys, a 600 m hero street through the old core ending at
  the tower cluster. Buildings are frontage-packed along streets from real asset footprints.
  Three districts, ~900 street lamps, ~450 signs, viewpoint anchors, a first flythrough.
  Top-down plan: `docs/progress/phase-1/plan.png`.
- **Buildings**: three Blender families (old slab with balconies/cages/AC units/canopies,
  mid-rise and industrial, setback glass tower), 16 variants, all shaded by one facade
  material (windows, storefronts, lit canopies, fixtures) in a single BatchedMesh draw.
- **Atmosphere**: sky dome with light-pollution glow, height fog, AgX + bloom + vignette +
  grain + chromatic aberration + SMAA.
- **Street**: wet asphalt with a planar reflection smeared into streaks, sodium light
  pools, lamp posts.
- **Signs**: invented neon and backlit signs from a canvas atlas (stroke glyphs, no font),
  broken tubes and flicker on the shared clock.
- Budgets hold everywhere: ≤30 draw calls, ≤1.52M triangles, 14 programs.

## Look at these first
1. `canyon.png` — the hero shot. Is this the direction? Sign density, colors (red/amber
   dominant, cyan rare), the streaks in the road.
2. `storefront.png` — close detail: shop interiors, canopy lighting, a big backlit panel.
3. `fly-50.png` and `horizon.png` — the city as a whole: towers vs. the old core, depth.
4. `aerial.png` — district read and whether towers look too beige from afar.
Blender previews: `node tools/debug/sheet.mjs 'buildings/*'` → `build/debug/sheet.png`.

## Known weaknesses (my critique, details in docs/NOTES.md)
- Facade surfaces are flat between windows; windows are stamped identically per cell.
- Signs float without brackets and spill no light onto walls or the street.
- Street level is empty: no props, haze, rain or traffic yet.
- Every tower wears the same bright white crown ring.
- Shimmer is untested in motion (stills can't show it). Please orbit in `npm run dev`.

## Open questions (docs/QUESTIONS.md)
- Tone mapping: I chose AgX. ACES is punchier and more saturated; want a comparison?
- Is the sign vocabulary acceptable (pseudo-CJK strokes plus generic English trade words)?

## Next (phase 3, widen)
Props (rooftop clutter, facade AC density, street props), skyline ring, signs in the rest of
the core, sign brackets and light spill, street haze, tower crown variety, facade surface
detail. Then motion (phase 4) and cameras (phase 5).
