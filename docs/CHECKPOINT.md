# Checkpoint B — the monorail (2026-11-15)

Brief: `docs/PERF-MONORAIL-PLAN.md`, Part B. Critique: `docs/NOTES.md`. Choices: `docs/DECISIONS.md`.

Look at first (`docs/progress/monorail/`, or `npm run dev` then `?viewpoint=`):
`monorail-platform` (train standing at t = 12), `monorail-line` (station and line toward the
towers), `monorail-under` (pier, girders, a train arriving). `glass` and `glass-before` show
the only pre-existing view that changed.

| | Before (A) | After | Limit |
|---|---|---|---|
| Draw calls, worst view | 230 | 234 (`monorail-platform`) | +8, 250 total |
| Extra draw calls per view | — | +2 to +6 | 8 |
| Extra triangles per view | — | +35k to +42k | 80k |
| Shader programs | 25 | 25 | no new program |
| GPU process memory | 784–797 MB | 795–828 MB | 920 |
| GPU frame time | see A | **not measured** | — |

Frame time: the perf runs ran with the machine locked or asleep and read 44–60 ms in every view,
3–5x slower than A, including views where the monorail is nowhere in sight. The one run
that looked normal read canyon 14.1, storefront 10.8, aerial 11.9, harbor 8.0 ms (`fast`). Please
run `npm run perf` on an awake, idle machine before accepting.

How it is built:
- Layout: `art/layouts/lib/monorail.mjs`, run last in `art/layouts/city.mjs`. The rest of the city
  is identical apart from what the line displaces (this seed: 4 lamps, 12 props, 3 signals, 5 signs).
- Assets: `art/generators/props/monorail.py` (13 pieces) and `art/generators/vehicles/monorail_car.py`
  (end car 968 tris, middle 568), all within the props and vehicles budgets.
- Runtime: static pieces as one merged draw; cars in the vehicle batch, moved by `trainCars()`.
- Tests: `tests/unit/monorail.test.ts` (straight route, piers clear of junctions, station on
  sidewalks, nothing in the envelope, flythrough clear, timetable pure and in range), 3 seeds.

Open: frame time; the nose and the station name (NOTES); rain under the roof.

# Checkpoint A — main app performance (2026-11-14)

Brief: `docs/PERF-MONORAIL-PLAN.md`, Part A. Detail: `docs/NOTES.md` (A0–A5).
Measured with `npm run perf` ×3, 1440×900 @2x, high quality, Apple M5, idle GPU.

| | Before | After | Target |
|---|---|---|---|
| GPU process memory | 1,736–2,037 MB | 784–797 MB | under 1,200 MB: met |
| Late frames | not measured | 0 % in all five views | — |
| GPU time at full clock (`fast`) | about 7.7–10.7 ms | 8.0–13.7 ms | — |
| GPU time, 95th percentile | 13.5–25.9 ms | 13.8–24.0 ms | replaced: late frames ≤ 5 % and `fast` < 16.7 ms, met |
| Draw calls, worst view | 230 | 230 | 20 under the 250 budget: met, exactly |

Per perf view (draw calls and triangles are unchanged by this work):

| View | Draw calls | Triangles | GPU `fast` / p50 / p95 after (ms) | GPU process after (MB) |
|---|---|---|---|---|
| canyon | 222 | 1.52 M | 9.4–10.0 / 15.0–15.6 / 17.5–18.3 | 784–797 |
| storefront | 228 | 1.64 M | 9.0–9.7 / 14.1–14.5 / 16.4–18.5 | 792–794 |
| aerial | 172 | 1.35 M | 10.8–13.7 / 17.0–18.2 / 20.1–22.7 | 788–790 |
| harbor | 172 | 1.41 M | 8.0–8.3 / 12.3–12.5 / 13.8–14.7 | 788–790 |
| fly-75 | 172 | 1.38 M | 10.0–10.4 / 16.3 / 17.9–24.0 | 788–791 |

The "before" timings are not comparable row for row: the perf test counted an empty frame per
real one until this checkpoint, which made its median read close to the minimum. Rendering
cost did not change; only memory did.

What changed:
- **Compressed textures (A1)**: tower, wall, interior and sign art textures are KTX2. About
  370 MB saved.
- **Flat varyings (A5)**: the unexplained 600–860 MB was Chrome's Metal backend rewriting an
  index buffer per draw for shaders with `flat` varyings. One WebGL extension call removes it.
- **A2, A3**: no change needed; the main app already did what the slice does.
- **Gates (A4)**: `npm run perf` fails over 920 MB of GPU memory, over 5 % late frames, or a
  full-clock GPU frame over 16.7 ms.

Look at first: `docs/progress/perf-A/` — `tower-detail`, `storefront` and `fly-50`, before and
after. These are the views where the texture change shows most. Everything visible: far
facades are very slightly softer (different mip filter); mean difference 0.04–0.52 of 255
across all 20 viewpoints. The flat-varying fix changes 18 pixels by 1/255 in five views.

Not met or open:
- The 95th-percentile target. The slow readings look like the GPU clocking down, not load: the
  same static picture reads 10 or 17 ms and no frame is late. Not proven. See QUESTIONS.md.
- Draw-call headroom is exactly 20; Part B's monorail may add up to 8.
- Only Chrome on Apple silicon was measured.
- Answered 2026-11-14: the KTX2 files are committed, the frame-time target is the late-frame
  one above, and `maxFrameMs` is 33.

Next: Part B (monorail) after review.

# Phase 6 — performance and polish (final)

`docs/SUMMARY.md` covers what was achieved, the shortfalls and the next steps. The shots are in
`docs/progress/phase-6/`. Try `?quality=low` against the default `high`, and free-fly (`2`)
into a wall.

- Budgets at `high`: 40 calls, 0.86M triangles max (was 1.95M), 24 programs. `low`: 24 calls, about 0.38M.
- Fixed from checkpoint 3: the overhead tip at t≈124 and free-fly entering buildings. The
  wide shot now has a far shore of lights.
- Open question: soften the square city edge with a light-only ground carpet? (QUESTIONS.md)
- Baselines are still stale for all 14 viewpoints; not approved.

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
