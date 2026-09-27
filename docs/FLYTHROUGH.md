# Flythrough

The cinematic camera (key `3`, or `?camera=flythrough`) is one closed loop of about **3 minutes** (186 s
for the default seed). It is built by `buildFlythrough` in `art/layouts/city.mjs` and played by
`src/systems/flythrough.ts`.

- **Path.** The layout writes control points plus a look-at target for each one. At runtime both
  become centripetal Catmull-Rom curves sharing one parameterization.
- **Speed.** Speed depends on height (`FLY_SPEED`): 7.5 m/s at street level, rising by
  0.17 m/s per meter of height, capped at 48 m/s. The screen motion therefore stays roughly
  steady, and the camera eases in and out wherever the path climbs or dives.
- **Determinism.** Position is a pure function of the shared clock, so
  `?camera=flythrough&t=90` always renders the same frame.

## The sequence (default seed; seconds from loop start)

| Time | Beat | What you see |
|---|---|---|
| 0–50 | **Canyon glide** | 4–5 m above the hero street, under the blades and footbridges, looking slightly up the street. Wet road reflections, traffic, lamp pools. Slowest part of the loop. |
| 50–70 | **Rising past the signs** | Climbs to about 40 m through the upper signs; the towers at the far end grow in the frame. |
| 70–90 | **Crane-up reveal** | Turns onto the arterial at the canyon's end and climbs along it, looking back at the tower cluster. Tower campaigns come into view at eye level. |
| 90–125 | **Tower orbit** | Circles the tower district just outside the outermost tower, climbing 120 → 280 m and looking in at the towers. Crowns and rooftop lettering pass close by. |
| 125–135 | **Over the city** | The view turns from the towers out over the old core, looking down on its street grid. |
| 135–150 | **Wide** | West of the city, beside the hero street's axis, at 280 m: the whole city with the tower cluster rising out of it. |
| 150–186 | **Glide home** | A straight descent down the hero street's axis over open ground. The lit street is a bright slot in the dark city wall, and the camera lands in the canyon mouth where the loop began. |

Contact sheet: `docs/progress/phase-5/` (frames at t = 66 … 182 s).

## Guarantees (tests/unit/city.test.ts, all three test seeds)

- The camera never passes through a building: at least 3 m from any footprint below roof height.
- It never comes within 2 m of a sign, and never passes through or just over a bridge.
  Signs and bridges are placed after the flythrough and give way to it.
- It stays at least 2.5 m above the ground everywhere on the curve, not only at the control points.
- No stretch climbs or dives steeper than 42°.
- The view never turns faster than 30°/s.
- At least a quarter of the loop is spent below 30 m. The loop lasts 90–300 s and wraps seamlessly.

## Tuning

`params.flythrough` in the layout def (defaults in `city.mjs`):

| Param | Default | Effect |
|---|---|---|
| `street` | 4 | Camera height in the canyon (m). |
| `orbitGap` | 45 | Clearance beyond the outermost tower (m). |
| `orbitHeight` | [120, 280] | Height at the start and end of the tower orbit (m). |
| `orbitSweep` | 0.8 | Orbit arc, in turns. |
| `wide` | 280 | Height of the wide shot (m). |
| `approach` | 440 | Length of the glide back into the canyon (m). |

For pacing, change `FLY_SPEED` in `src/systems/flythrough.ts`. The fly-* viewpoints sample the
loop at 0, 25, 50 and 75 % of its duration (time, not distance).
