# Checkpoint 3 — cameras (phase 5)

Press `1`/`2`/`3` for the orbit, free-fly and flythrough cameras, or open `?camera=flythrough`.
The loop is described beat by beat in `docs/FLYTHROUGH.md`. The contact sheet is in
`docs/progress/phase-5/`, and the fly-0/25/50/75 shots are in `build/shots/city/`.

- Judge the pacing: is the canyon glide (about 50 s at 7.5 m/s) too slow or just right, and is ~3 min too long?
- Weakest frames: the overhead tip at t≈124, and the empty black ground around the wide shot.
- Baselines are stale for all 14 viewpoints (sign and camera work); not approved.

# Checkpoint 2 — widen (phases 1–3 of the revised order)

Shots: `docs/progress/phase-3/` (also `build/shots/city/`), 1280×720, `t=12`. No baselines
exist yet; approve them if you like what you see (`npm run shots:approve`).

## What changed since checkpoint 1
- Buildings: photographic tower facades (your atlases), interior-mapped windows, image wall
  materials, recessed windows and railings on detailed slabs, tower ribs, 12 tower
  variants with six crown types, walk-ups, car parks, estates, mid-rise variety, rooftop
  tanks/antennas/cranes, deterministic window opening patterns (party walls, stair columns).
- Light and air: window glow, canyon glow, sky rim, cool sky light (dimmed ~30%), city
  haze post effect, lit 3D cloud deck, a shared city reflection capture.
- Street: tall mid-height signs, poster screens, crisp neon text, sign brackets, sign light
  spill, footbridges and skybridges, traffic light streams, 1,176 street props.
- Performance: LOD variants swapped by distance (aerial 2.8M → 1.8M triangles incl. props).

## Look at these first
1. `canyon.png` and `fly-0.png`: the hero street, now meant to be the strongest shot.
2. `skyline.png` / `skyline-wide.png`: the composition you compared with the generated image.
3. `architecture.png` and `tower-detail.png`: close building detail.
4. `storefront.png`: street furniture and shopfronts up close.

## Known weaknesses (details in docs/NOTES.md)
- Canyon walls are evenly lit end to end; no shadow pools between lamps.
- Props are small against wide sidewalks; guardrails only near junctions.
- Posters are invented drawings; your own billboard images would improve them a lot.
- The city edge is abrupt from `aerial` (no skyline ring, by your earlier call).
- Shader programs at 22 of 25.

## Open questions (docs/QUESTIONS.md)
- Tone mapping AgX vs ACES; sign text vocabulary (from checkpoint 1, still open).
- Would you like to supply 10–32 invented billboard images for the screens?

## Next (phase 4, motion)
Rain (camera-relative instanced streaks), vehicle hulls for traffic and flying vehicles,
window/sign flicker tuning, steam at street level; all on the shared clock and
reproducible under `?t=`. Then cameras (phase 5, checkpoint 3).
