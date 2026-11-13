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
  `npm run check` and `npm run shots`, then look at the screenshots.
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

## Typeset sign designs (2026-11-13)

Simple shop signs no longer need an image each. `tools/textures/build_sign_designs.py`
(`npm run signs:designs`) sets real trade words from `art/signs/designs.def.json` in the
bundled fonts and bakes 144 designs into one data atlas, `art/textures/signs/designs.png`
(R ink, G part id, B backlit face), with `designs.json` beside it. The sign shader colours each
instance, so one design appears as red neon on one building and a pale lightbox on another.

- **Add a sign:** add `{ "jp", "en"?, "icon"? }` to `words` in the def and rebuild. Trades and
  services only, never real brands. Words are spread evenly over the slots.
- **Styles** (shares in the def): `neon` (solid glowing letters on a dark board), `tube` (thin
  even strokes, like bent glass), `outline`, `box` (lightbox) and `plate` (dim printed plate).
- **Slots:** tall and short blades, wide and small panels; counts and pixel sizes are in the
  def's `classes`. The build fails if they overflow the atlas.
- **Fonts:** Noto Sans JP (two weights), Dela Gothic One, Kaisei Tokumin and Reggae One for
  Japanese, Barlow Condensed for Latin; all OFL, build time only.
- **Brands:** the eight tower wordmarks and stacked logos are in the same atlas, set in Barlow
  Condensed from the def's `brands` list (fixed names; they no longer change with the seed).
- The layout picks a design per sign (`design` index) and sizes the sign to its aspect, the same
  way it treats catalog artwork. `signs.artShare.street` in `art/layouts/city.mjs` sets how many
  street placements use artwork versus typeset designs.
- Look at `build/previews/signs/designs.png` after every rebuild.
