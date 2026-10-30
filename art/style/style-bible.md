# Style bible

This file is binding for every visual decision. The human owns it; agents
propose changes to it but never silently deviate from it. When the same
feedback comes up twice in review, it becomes a rule here.

## Reference world

The reference is a late-20th-century Asian megacity pushed one step into the
future: Mong Kok, Kowloon and Nathan Road density; Y2K techno-optimism gone
shabby; wet streets at 2 a.m. The city is old, crowded and lived-in, with newer
glass towers rising out of it. It should not read as clean chrome.

## The one bold element

The hero element is the street canyon. At street level, looking up through a
narrow gap, neon signs project over the road from both sides. The wet asphalt
reflects all of it as long vertical smears.

Everything else supports this shot and stays comparatively quiet.

## Light

Light should mostly be practical and motivated: sodium lamps, fluorescent tubes
in apartments, warm tungsten, TV flicker. Saturated neon is an accent, not the
base.

Do not default to magenta and cyan everywhere.

## Details that sell it

- rooftop clutter
- AC units dotting facades
- blinds in some windows
- a TV-blue flicker in a few
- elevated walkways or a flyover
- steam or haze at street level
- rain

## Palette

Colors come only from `palette.json`, referenced by name in generators and
runtime code. No hex literals in generators. Add a named color there first.

| Name | Use |
|---|---|
| `sodium` | street lamps, lamp pools |
| `fluorescent` | apartment tube light |
| `tungsten` | warm interior light |
| `tv_blue` | rare TV flicker |
| `sign_red`, `sign_amber` | neon accents |
| `sign_cyan` | neon accent, used sparingly |
| `haze` | fog and street-level haze (cool blue-grey since 2026-09-25, per the references) |
| `sky` | night sky (deep blue) |
| `concrete`, `concrete_dark`, `tile_stained` | facades |
| `metal_dark` | frames, rails, rooftop units |
| `glass_dark` | unlit glass |
| `road_wet` | asphalt |
| `sidewalk` | pavements |
| `paint` | worn road markings |
| `paint_mint`, `paint_salmon`, `paint_cream`, `paint_blue` | faded paint on old residential slabs (desaturated; added 2026-09-25 with the building pass) |

Legacy keys still referenced by the template's sample generators and defs are
kept as aliases of the colors above: `concrete_light` = `tile_stained`,
`warm_interior` = `tungsten`, `neon_amber` = `sign_amber`, `neon_cyan` =
`sign_cyan`, `neon_magenta` = `sign_red`. New code uses the new names.

## References
Mood images live in `references/`. Describe what each one is for in a line
below, so agents know what to take from it. Commit only downscaled copies (long edge
1600 px, metadata stripped, `ref-<place>-<subject>.jpg`); full-resolution originals go in
the gitignored `references/_raw/`.

- `ref-skyline-blue.png` — skyline composition: many slender towers of very different
  heights, thin vertical LED lines on a few, big screens on some faces, deep blue sky.
- `ref-skyline-teal-fog.png` — depth: layers of towers fading into teal haze, red aviation
  lights on almost every roof, warm windows against cool atmosphere.
- `ref-aerial-dense.png` — density from above: no gaps, dark tower bodies with fine window
  grids, warm streets glowing between them, city to the horizon.
- `ref-hk-ifc-night.jpg` — real Hong Kong (human, 2026-10-24): one hero supertall with a
  ribbed lantern crown, dark glass with warm horizontal floor bands, a lit low cloud over
  the island and black water. Use for tower-district landmarks and cloud/water mood, not the
  old-core canyon.
- `ref-hk-waterfront-night.jpg` — real Hong Kong (human, 2026-10-24): a canopy and railing
  foreground frames a varied island skyline; warm-white windows dominate, green/cyan/red
  crowns are rare accents and tower ads are almost absent. Use for framing, restraint and
  crown colour.
- `ref-hk-harbour-panorama.jpg` — real Hong Kong from above (human, 2026-10-24): residential
  towers frame a park/water gap; the far skyline is a low band with a few landmark crowns,
  not a uniform wall. Use for aerial composition, negative space and the supertall hierarchy.
- `ref-hk-residential-night.jpg`, `ref-hk-residential-night-wide.jpg`: real Hong Kong
  residential district at night (human, 2026-10-28). Slender 30–50-floor point towers with
  notched plans whose recessed slots read as dark vertical lines. Mixed cladding (terracotta,
  cream tile, dark glass) and 50–60 % of windows lit, mostly warm with some cool white. A low
  cloud deck lit brown-orange from below, a dark mountain ridge behind. Use for residential
  towers, lit-window density and sky colour.
- `ref-hk-residential-towers-day.jpg`: the same tower type by day (human, 2026-10-28):
  plan notches, balcony stacks, roof water tanks and masts, low walk-ups below. Use for
  residential tower massing and roof silhouettes.
- `ref-hk-walkup-corner-day.jpg`: old Hong Kong walk-up (human, 2026-10-28). White tile
  with grey horizontal bands, window hoods, boxed bay windows, an AC unit under almost every
  window, a curved corner over the shopfront. Use for old residential facade detail.
- `ref-hk-office-tower-day.jpg`: Hong Kong office tower (human, 2026-10-28): dark
  reflective glass between pale vertical mullion fins and a stepped top. Use for curtain-wall
  rhythm.
- `ref-hk-tram-boulevard-day.jpg`: Hong Kong boulevard from a footbridge (human,
  2026-10-28). Glass towers stand on 3–6-storey podiums with canopies; a footbridge crosses
  the road; tram tracks and planters run down the median. Use for podium/street structure
  and footbridges.
- `ref-tokyo-sign-buildings-day.jpg`, `ref-tokyo-street-day.jpg`: Tokyo electric-town
  streets (human, 2026-10-28). Narrow buildings carry vertical stacks of signs, box
  billboards crown the roofs, banded mid-rise offices. Use for sign stacking and rooftop sign
  boxes (no real brands).
- `ref-tokyo-office-night.jpg`: Tokyo office towers at night (human, 2026-10-28): offices
  almost fully lit in cool white, a single lit crown edge, a few thin LED accent lines, a
  warm cloud base. Use for office-tower night lighting.
