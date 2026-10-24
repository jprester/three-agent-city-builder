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
below, so agents know what to take from it.

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
