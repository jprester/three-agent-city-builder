# Style bible

This file is binding for every visual decision. The human owns it; agents
propose changes to it but never silently deviate from it. When the same
feedback comes up twice in review, it becomes a rule here.

## Mood
Placeholder, replace per project. Example: dense, rain-soaked late-night
city. Oppressive verticality, most light coming from windows and signage
rather than the sky. Lived-in and worn, never showroom-clean.

## Palette
Colors come only from `palette.json`, referenced by name in generators and
runtime code. No hex literals in generators. Add a named color here first.

## Materials
- Concrete: rough (0.8-0.95), never pure flat grey; vary between the three
  concrete tones per building.
- Metal: dark, semi-rough (0.4-0.6), used for frames, rails, rooftop units.
- Glass: dark and slightly reflective when unlit; lit windows are emissive,
  mostly warm interior tones with neon as the minority accent.

## Do
- Break up large flat surfaces with ledges, setbacks, rooftop clutter.
- Keep emissive accents sparse enough that they read as accents.

## Don't
- No saturated colors on large surfaces.
- No perfectly regular window lighting; lit ratio is always randomized.

## References
Mood images live in `references/`. Describe what each one is for in a line
below, so agents know what to take from it.
