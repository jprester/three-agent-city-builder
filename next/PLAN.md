# Fresh slice: next work

Brief for an implementation session. Read `AGENTS.md` and `next/README.md` first; this file says
what to build next in `next/`. Written 2026-11-14 on branch `fresh-slice`.

## Where things stand

`next/` is a small night city built from scratch on WebGPU (`npm run next:dev`, port 5183; it
opens on a flyover along the monorail, keys `1`-`7` are fixed views). It has the right
structure and passes its gate, and it is a blockout: almost everything is boxes.

- State, design and critique: `next/README.md`, and the "Fresh slice" sections at the end of
  `docs/NOTES.md` and `docs/DECISIONS.md`.
- Images of the current look: `docs/progress/fresh-slice-monorail/`.

## Scope the human set

- A **realistic city with some futuristic elements**. No megastructures, no far-future
  transport. The monorail stays at its current height.
- The monorail is a **straight suspended line** (Chiba style). No curves, branches or grades.
- Work only in `next/` and the docs. Do not touch the main app (`src/`, `art/`, `public/`).

## How the slice is built (keep it this way)

- `plan.ts` is the data; `build.ts` turns it into geometry. Add dimensions to the plan, not
  constants scattered through the builders.
- Everything structural is the `Boxes` batch: one instanced draw. Use `boxes.add(...)` for
  parts and `boxes.tube(...)` for a fluorescent tube that should also light its surroundings.
  Do not add meshes or materials per part.
- No light objects. Practical light is emission plus the three top-down maps
  (`lightmaps.ts`). The fixture map holds three height layers; a tube at a new mounting
  height can merge layers, so check `under` and `deck` for light leaking upward afterwards.
- Trains are a `Boxes` batch per train, built around the car floor at y = 0 (`train.ts`).
- All randomness from `mulberry32`. Colours from the palette by name.

## Task 1: detail the monorail

It is the centrepiece and reads as blockout up close. Make it hold up in `line`, `platform`,
`under` and the flyover.

1. **Cars** (`train.ts`): door openings (two per side per car, darker recess with a lit
   threshold), a visible interior behind the window band (ceiling light strip, seat backs,
   a few standing figures as simple silhouettes), a smoother taper at the ends (more, thinner
   steps), a destination display at each end, bogie struts that look like hangers rather than
   blocks. The side that faces the platform must not be a flat dark slab.
2. **Girders and piers** (`build.ts`): segment joints every pier span, brackets where the
   girder meets the arm, a cable tray or walkway rail along the top, a base detail where the
   pier meets the median. Keep the light line under each girder.
3. **Station**: replace the south stair (a 13 m solid ramp of blocks) with an open stair:
   stringers, separate treads, a landing halfway, handrails. Give the short north flight the
   same treatment. Stop the portal legs passing through the pedestrian deck (notch the deck or
   move the legs). On the platforms: a station name board, a timetable case, a clock, floor
   markings at the door positions, a second vending machine style, a bin.
4. **Light on the train at the platform**: the train's side is unlit when it stands in the
   station. Solve it within the existing lighting model (a tube line over the track edge, or
   door-threshold light), not with a light object.

Done when: the four views above no longer read as boxes at a glance; a train standing in the
station is clearly a vehicle with doors and people in it; the stairs look walkable.

**Checkpoint.** Stop here, save images to `docs/progress/fresh-slice-monorail-detail/`, write the
critique, commit, and report. Do not start task 2 without the human's go-ahead.

## Task 2: road vehicles

Cars are one box body with a cabin (`traffic.ts`, `carGeometry`). They are in the foreground of
most street views.

1. Three or four body types from the same part scheme (sedan, hatchback or kei car, van,
   taxi with a roof light), chosen per car from its seed. The simulation and the storage
   buffers stay as they are; only the geometry and the vertex-stage selection change.
2. Wheel arches, a sloped windscreen and rear window, mirrors, number plates, a lit interior
   hint through the glass.
3. Headlamp and tail lamp shapes per type; keep brake lights reacting to the simulation.

Done when: a queue at the signal in `corner` and `line` shows visibly different vehicles and
none reads as a plain box.

## Verification (every task)

1. `npm run next:dev` and look, with the clock running and with `?t=20`.
2. `npm run next:shots`: all viewpoints pass, no browser errors. Look at every image in
   `build/shots/next/`. Report draw calls, triangles and frame time.
3. `npm run check` and `npm test` pass.
4. Frame time is only meaningful on an idle GPU. If another browser window is using it (the
   human often has the main app open on port 5173), say so instead of reporting a regression;
   compare against the previous commit in the same session if in doubt.

## Budgets (`next/budgets.json`)

60 draw calls, 600,000 triangles, 16.7 ms per frame, 900 MB GPU process. The slice is at 32
calls and 261,000 triangles, so there is room for detail, but each box is 12 triangles and the
reflection pass draws them again: keep the monorail detail under about 60,000 added triangles
and say what you spent.

## Docs to update when done

- `next/README.md`: what changed, what is still weak.
- `docs/NOTES.md`: a specific, harsh critique of the result.
- `docs/DECISIONS.md`: one line per non-obvious choice.
- `docs/progress/`: images at each checkpoint.

## Known open items, not part of this brief

- Glass towers light in a regular pattern that reads as a barcode from above.
- Shop interiors are one procedural room with noise for goods.
- No pedestrians, no audio.
- TSL is imported untyped (`src/tsl.ts`).
- The WebGL 2 fallback is untested.
