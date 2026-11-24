# Signs and ads: plan for a coherent system

Status: **in progress** on branch `ads-tenant-signs` (2026-11-24, paused for the night,
uncommitted). The system as built is described in docs/ADVERTISING.md. Remaining: render round 3
(`python3 tools/textures/build_signs.py --candidates "$(cat build/signs-round3.txt)" 2 6000`;
13 of its 40 signs already have both seeds cached), review `build/previews/signs/candidates.png`,
pin picks in `seeds`, `--render` (the renamed businesses flower, dental, soroban, spa, store_hk have
no source yet). Then give any blade still garbled `only` (drop it), pack (`npm run signs`), run tests,
shots (`npm run shots`, frame times measured with no renders running), commit.

**Hero billboards (human review 2026-11-24, after the first shots):** the big downtown tower
billboards and shaft campaigns look underwhelming: low resolution (packed at 1024 / 768 px for
boards 20-70 m tall) and the wrong theme (noodles, beer, energy drink read as small-shop ads). Big
billboards should carry high-quality fashion and luxury campaigns (classy). Decision (human): keep
local Z-Image for the signs and the smaller image ads (rooftop boards, street-level billboards,
screens); the big tower hero ads (`wide`, `tall`, zones billboard and shaft) come from GPT or
Midjourney, made by the human, imported into `art/external/` with a manifest entry. They need
their own higher-resolution atlas (long edge ~2048 px). Food, drink and loan brands then stay on the
roofs and low buildings. Not yet built: street props (menu lightboxes, A-frames, lanterns) and
dedicated roof lattice frames. The plan below is kept as the record of the decisions.

## Decisions (human, 2026-11-23)

- **Replace everything** to enforce one consistent style: the Midjourney/GPT library in
  `art/external/textures/signs/` (271 entries), the typeset designs (`art/signs/designs.def.json`,
  144) and the unused typeset pilot (`art/advertising/`). Old sources stay on disk as reference,
  like the retired photo facades.
- **Language mix:** mostly Japanese and Chinese at street level; English for international brands
  higher up.
- **Real-life references** set the sense of the system (Kabukicho and Yasukuni-dori in Shinjuku,
  Nathan Road / Mong Kok in Hong Kong; the human's reference photos, not committed: third-party
  images). What they show is written down below.
- **Placements must be logical.** Counter-example from the current city: an "出口 Exit" wayfinding
  board mid-wall on a residential facade, and small floating neon text plates on a podium band in
  a different style from each other, one with nonsense characters.

## What the references show (the rules to build)

1. **Every sign belongs to a tenant of that building, at its floor.** Upper-floor tenants (karaoke
   4F, clinic 3F, izakaya 5F, consumer loans 3F) advertise with their floor number on the sign
   ("4F", "B1", "当ビル5F"). No sign without a business; no wayfinding or exit signs on buildings
   (those live in stations and on poles).
2. **Mounting types, each in its place:**
   - *Fascia*: a wide lightbox or channel letters over the shop door, one per shopfront, at the
     canopy line.
   - *Projecting blade*: a tall narrow box perpendicular to the street at the tenant's floor; on
     busy streets several stacked down the building's edge.
   - *Tenant column*: a vertical stack of equal tenant panels at a building corner or edge, one per
     floor (name + floor number), the Japanese "袖看板" column; the most characteristic element in
     the Shinjuku photos.
   - *Upper-wall billboard*: a big panel on a blank upper wall for the tenant inside (food photo,
     name, floor), often with floodlights.
   - *Rooftop billboard*: big brand boards on exposed steel lattice frames with a row of
     floodlights along the top edge; brands (loans, drinks, pachinko), not shops.
   - *Hong Kong overhang*: large neon boards cantilevered far over the street on steel frames,
     stacked at several heights and overlapping in depth along the street (Nathan Road); neon tube
     lettering with tube borders, Chinese characters, pawnshop and karaoke/nightclub signs.
   - *Street level*: menu lightboxes, A-frames, lanterns, shopfront displays.
3. **Materials:** in Shinjuku most signs are backlit acrylic lightboxes in saturated flat colours
   (yellow, red, green, white) with bold type; neon is the minority. In Hong Kong exposed neon tubes
   dominate. Both are dense: signs overlap in depth, nothing is a lone plate on a bare wall.
4. **Text is real**: real words, readable, consistent per business.

## Plan

1. **One pipeline**: `art/signs/` defs → `tools/textures/build_signs.py`: Z-Image Turbo renders from one
   style template (front view, isolated on near-black, lightbox acrylic or glass-tube neon, palette
   from the style bible), crops, packs into the atlases the runtime already reads; prompts, seeds and
   picks recorded (as for walls and sounds).
2. **Businesses** (~40 fictional: ramen, izakaya, karaoke, mahjong, pawnshop 押, pharmacy, clinic,
   hotel, tea house, arcade, consumer loans, manga café…), each with a name (JP or ZH), colour, icon
   and its sign set: fascia, blade, tenant panel, optional upper-wall billboard. A building's floors
   get tenants; its signs are its tenants' signs. Z-Image draws short JP/ZH sign text well (tested:
   ラーメン, 金龍酒家 correct).
3. **Brands** (~10, rooftop and tower): text-free campaign artwork from Z-Image plus a typeset
   wordmark in a fixed font per brand (Z-Image garbled multi-word English: "VOLAY ELECTRIC"; it also
   mocked up whole billboards in a scene).
4. **Placement** rewritten around tenants and mounting types above (tenant columns at corners,
   floor numbers, HK overhang stacks on the island's main roads, rooftop lattice frames with
   floodlights); no sign without a tenant, no wayfinding boards on facades.
5. Verify with shots at street level (canyon, storefront, delivery) against the references.

Estimated size: a session of its own (~120 renders at ~50 s, picking, packing, placement, shots).
