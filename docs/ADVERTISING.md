# Advertising pilot

The city now uses a hybrid library: 12 typeset shop signs and six illustrated campaigns,
each composed in portrait, landscape and tall formats (30 designs total). Brand names
and all copy are drawn using bundled fonts. Images contain illustration only.

## Authoring

- Edit `art/advertising/catalog.def.json` for copy, palette names and campaign sources.
- Original text-free illustrations live in `art/advertising/artwork/`. The exact built-in
  image generator prompts are recorded in `art/advertising/PROMPTS.json`.
- Run `npm run signs` to compose textures, pack atlases and regenerate layout references.
  `npm run assets` also runs the advertising builder. Python 3 with Pillow is required.
- Inspect all variants in `build/previews/advertising/`, then run `npm test`,
  `npm run check` and `npm run shots`. Missing/different baselines need human review.
- Commit sources, `art/textures/advertising/` and regenerated layouts together. Do not
  edit generated atlas pixels or catalogue indices directly.

Noto Sans JP and Barlow Condensed are bundled under OFL in `art/external/fonts/`, with
licenses and source attribution in the external manifest. Fonts run offline at build
time; no browser font download or platform font dependency is introduced.

## Rendering contract

The four padded WebP atlases preserve RGB color and store emission strength in alpha.
**Alpha is not transparency.** The opaque sign shader illuminates letters/tubes while
leaving the backing unlit; backlit panels and screens use separate gains. WebP preserves
RGB even where alpha is zero. Six portrait campaigns also feed the facade screen grid.
UV rectangles, pixel bounds, aspect ratio, surface class, accent and emission gain are
recorded in the generated catalogue. Gutters have extruded edges for mip filtering.

Runtime metal housings use the existing instanced sign system: projecting blades have
arms, lightboxes have frames, and tower screens have frames/back rails. All hardware is
one instanced draw. Tower shaft slots prefer broad campaign screens and omit undersized
slots instead of placing enormous shop signs high on glass towers.

The previous Midjourney sources and atlases remain intact for future curated reuse;
they are no longer the default runtime library. This pilot intentionally keeps the
warm street palette rather than reproducing the reference's city-wide magenta wash.

## Extending the library

Add another campaign with a text-free portrait illustration and short copy, then rebuild.
The builder creates three reflowed formats automatically. Atlas packing fails explicitly
if a sheet exceeds the configured maximum; expanding beyond that requires adding another
atlas/shader binding or a texture-array strategy. It is not an unlimited library.
The layouts currently share a template per format; custom campaign layouts and richer
weathering are the next art improvements, not more random text or colors.
