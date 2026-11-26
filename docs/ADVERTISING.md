# Signs and ads

One library in one style (2026-11-24, docs/ADS-PLAN.md): every sign belongs to a tenant of its
building, at the tenant's floor, or to a brand on a roof or a tower. The earlier libraries (the
Midjourney/GPT set in `art/external/textures/signs/`, the typeset designs in
`art/signs/designs.def.json`, the typeset pilot in `art/advertising/`) stay on disk as reference;
the city no longer draws them.

## The library: `art/signs/signs.def.json`

- **Businesses** (fictional): id, trade, script, floor, sign text, face and ink colours, icon.
  - `ja`, floor 1: street shops, each with a **fascia** (wide lightbox) and a **blade**.
  - `ja`, floor 2–8: upper-floor tenants, each with a square **panel** for the tenant column and a
    **blade**, both showing the floor number ("4F"). Some also have a two-floor **billboard**
    (food photo, name, floor).
  - `zh`: Hong Kong neon, each with an **overhang** board and a vertical neon **hkblade**.
  - `only` limits a business to some formats (the hotel: one tall blade).
- **Brands** (fictional; food, drink, airline, bank, loans; two domestic ones in Japanese): a
  text-free Z-Image photo, `land` and `tall`, plus a wordmark and tagline that the builder typesets
  in a bundled font (with a dark band). They produce a rooftop **board** (~2.4:1) and a 2:3 crop for
  the facade video screens. Only `crown` brands (the bank, the airline) also get crown lettering.
- **Heroes** (fictional fashion and luxury houses, 2026-11-26): Midjourney campaign photos made by
  the human (`art/external/hero-ads/`, prompts in docs/HERO-ADS-PROMPTS.md). Each image names its
  format (**wide** 16:10 tower billboard, **tall** 1:3 tower-shaft campaign, **screen** facade
  screen only) and the calm box where the builder sets the wordmark: `pre` small above, the name,
  `tagline` small below, tracked, in Bodoni Moda (600, optical size 11: at size 96 the hairlines
  vanish at tower distance) or Jost, light or dark ink by the box's brightness, no band. Variants
  (`wide2`, `tall2`) are alternatives the placer picks among. Every hero also gets crown lettering
  in its own font. The delivered PNGs stay local (gitignored); the builder keeps a WebP of each,
  committed. Review: `--heroes` draws `build/previews/signs/heroes.png`.
- **Style**: one prompt template per format (`styles`, `formats`, `background`): front view,
  isolated on black, backlit acrylic lightbox (Shinjuku) or exposed glass neon on a steel frame
  (Mong Kok).

## Pipeline: `tools/textures/build_signs.py`

1. Every sign's seed is pinned in the def's `seeds`; a new sign defaults to `seed` + crc32 of its
   id, never its list position (removing a business once shifted every later seed and started
   re-rendering good signs). `--render [glob]` renders every sign whose source is missing or whose
   pinned seed changed
   (`img`, Z-Image Turbo, ~50 s each). It crops each take to its sign and writes it to
   `art/external/signs/<id>.webp`, which is committed. `takes.json` beside the sources records the
   exact prompt, size and seed of each one. Takes stay in `build/signs-takes/`.
2. `--sheet` draws `build/previews/signs/sources-<format>.png`. **Read every sign's text.**
   Z-Image often garbles characters, repeats them on tall boards, or slips into simplified
   Chinese (动, 习). Round 1 got about half of the Japanese text right; tall blades fared worst.
   After three rounds (2026-11-26) every fascia, panel, billboard and overhang is correct, but
   only about half the blades: vertical text repeats characters (料料理, 夜總總會). Blades that
   never came right are left out with `only`, and the business keeps its fascia or panel. Of the
   Hong Kong vertical neon only 海鮮酒家 survived. Some words never render correctly and were
   swapped for real alternatives (サウナ→スパ→dropped, 歯科→デンタル, 学習塾→そろばん,
   珈琲→カフェ, 不動産→フラワー). `rejects` in the def records what failed and why.
3. Re-roll a failure: `--candidates <id,id> <n> <first seed>` renders n seeds side by side
   (`build/previews/signs/candidates.png`). Pin the pick in the def's `seeds`, note it in
   `rejects`, and run `--render`.
4. Running with no flag packs the sources and the hero campaigns, longest edge per format (`SCALE`;
   heroes 1280 px wide, 1536 px tall), into shelf-packed
   atlases `art/textures/signs/signs_<i>.webp`: RGB colour, alpha the emission mask, at most four
   atlases of 4096 px. The atlas count must match `art/textures/ktx2.def.json` (the packer checks
   it). It also writes `screens.webp` and `catalog.json` (per sign: owner, format, floor, script,
   atlas, UV rect, aspect, light colour, gain).
5. `npm run textures`, then `npm run layouts`. `npm run signs` runs steps 4 and 5.

## Placement: `art/layouts/lib/signs.mjs`

Placement has its own random stream, so changing signs never moves anything else in the city.
Per street frontage (`hero` dense, `core` sparse, the island's ring, avenues and quiet streets):

- **Street level:** the front is split into shopfronts, one business each. A fascia stands on the
  canopy's front edge (or sits on the wall over the window); the shop's blade hangs above the
  canopy at the shopfront's edge.
- **Upper floors** (2 up to `tenantFloors[family]`: commercial 8, midrise 7, slab 5, walkup 3) are
  let to tenants whose own floor is that floor, so 4F karaoke is always on the fourth floor.
  Floor heights come from the facade cells (ground 4.8 m; then 3.0, 3.6 or 3.8 m by family).
  - The **tenant column** stacks the panels at one edge of the front, one per floor, joined by
    frame rails.
  - **Billboards** cover the tenant's floor and the one above.
  - **Blades** hang at the tenant's floor.
- **Island (Hong Kong):** every tenant is a `zh` business. Neon overhangs reach 0.4–1.8 m clear
  of the wall and 3–6.5 m out, stacked by floor, with vertical neon blades between them.
- **Rooftop frames** carry a brand board on a steel lattice, lit by floodlights along the top edge.
- **Towers:** podium fascias (one per shopfront, some units left empty), a hero billboard at
  15–50 m, hero campaigns on the shaft, and crown lettering (heroes, bank, airline). Each tower
  zone keeps its own least-used count, so the brands spread evenly over billboards, shafts and
  crowns.
- **Hotels:** a tall blade sometimes climbs an old slab (businesses marked `tall`). There is none
  at present: the ホテル blade never rendered correctly.
- **No wayfinding** and no sign without an owner. `tests/unit/city.test.ts` checks owners,
  formats, mounting, floors and overlaps. A clash pass drops overlapping signs, island ones
  included.

## Rendering: `src/scene/signs/`

- **Boards:** every sign except crown lettering is a box in one instanced draw. The ±Z faces
  sample the sign's atlas; the black around a sign reads as its dark case. Emission is the image
  times the catalog gain (photo boards are dimmed at pack time like an LED screen: gain ×
  min(1, (0.12 / mean linear luminance)^0.7), so a white-sky campaign doesn't bloom into a slab); tower campaigns get ×1.8 and everything is ×0.6 by day. A few neon
  boards (12 %) and the odd lightbox (3 %) flicker like a failing tube.
- **Crown lettering:** additive planes with no board.
- **Hardware:** case lips, blade arms, column rails, roof posts and floodlight arms are one more
  instanced draw; the lamp heads are a third.
- **Light map:** each sign's measured light colour feeds the sign light map (facades, wet streets).

## Street props and roof frames (2026-11-26)

- **Standing signs** (置き看板): a shop with a blade may put a small copy of it on the pavement by
  its door, 0.3–0.9 m in front of the wall (clear of the walkers' line), facing along the street,
  on a weighted foot (`stand` in the hero/core configs: 0.6 / 0.35).
- **Lanterns:** businesses with `lantern` (ramen, gyoza, yakiniku, chuka, tachinomi, tendon) hang a
  row of 2–4 red paper lanterns under their canopy's front edge (`lantern`: 0.85 / 0.6). One sign
  per row (kind `lantern`, `count`); bodies are one MeshBasic draw of low-poly spheres (the same
  shader program as the floodlight heads), caps and cords are boxes in the hardware draw, and each
  row feeds the sign light map.
- **Rooftop lattice:** every rooftop board stands on exposed steel: columns behind the board down
  to the roof, girts, X-bracing in every bay, raking struts back to the roof and a catwalk with a
  rail along the bottom edge. It's all in the hardware draw (members rotated into place), so it
  adds no draw calls.
- **Not built:** wall menu lightboxes. They need menu art (dish photos and prices) the library
  doesn't have; the standing signs fill that spot at the door.
