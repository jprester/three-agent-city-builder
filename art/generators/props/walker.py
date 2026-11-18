"""Pedestrian under an umbrella, low poly (~250 tris), front at -Y (+Z at runtime: the
walking system turns it along its sidewalk loop). Facade-shaded: the coat is car paint
(metal fill 0.2), so the shader gives every walker its own coat color from the instance's
paint pick; legs, hair and the umbrella use fixed metal subtypes. `umbrella`: "black"
(rubber-dark) or "clear" (pale, like the transparent umbrellas of Tokyo). `hem`: the coat's
lower edge in meters (0.6 a long coat over a flared skirt, ~0.8 a short jacket).

Walk cycle: thighs, shins (with feet) and the free arm are tagged body parts (lib.mesh
`limb`), which the facade vertex shader swings about their hip, knee and shoulder pivots by
the gait phase each walker carries (src/systems/vehicles.ts, src/materials/facade/vertex.ts).
Limb codes: |code| 1 thigh, 2 + hip/10 shin (pivot the knee, hip height in the fraction),
3 arm; the sign is the gait side (+1 swings forward when the +X leg does)."""
from math import cos, sin, tau

from lib.mesh import MeshBuilder
from lib.surface import plan_uv, surf

CLEAR = 0  # car_white in the shader's car paints (vehicles/car.py CAR_PAINTS)
SKIN = 7   # car_beige


def generate(ctx):
    mb = MeshBuilder(ctx.name)
    coat = surf(ctx, "metal", 0.2, 0.5)                 # random paint per instance
    dark = surf(ctx, "metal", 0.75, 0.5)                # rubber: trousers, hair, black canopy
    metal = surf(ctx, "metal", 0.0, 0.5)
    clear = surf(ctx, "metal", 0.3, (CLEAR + 0.5) / 12)  # fixed paint: pale canopy
    canopy = dark if ctx.p("umbrella", "black") == "black" else clear
    box = lambda x0, x1, y0, y1, z0, z1, s: mb.box(x0, x1, y0, y1, z0, z1, s[0], None, (), s[1], plan_uv)
    skin = surf(ctx, "metal", 0.3, (SKIN + 0.5) / 12)
    hip, knee, shoulder = ctx.p("hip", 0.88), ctx.p("knee", 0.47), ctx.p("shoulder", 1.4)
    hem = ctx.p("hem", 0.6)

    # Legs: thigh (pivot the hip) and shin with its foot (pivot the knee). Pivots sit on the
    # leg's center line, forward 0 (runtime axes: height, forward).
    for side, x in ((1, 0.09), (-1, -0.09)):
        mb.limb = (hip, 0.0, side * 1)
        box(x - 0.065, x + 0.065, -0.07, 0.07, knee - 0.03, hip + 0.02, dark)
        mb.limb = (knee, 0.0, side * (2 + hip / 10))
        box(x - 0.055, x + 0.055, -0.06, 0.06, 0.06, knee + 0.01, dark)
        box(x - 0.06, x + 0.06, -0.17, 0.05, 0.0, 0.08, dark)         # shoe, toe forward
    mb.limb = None

    # Coat: torso, a flared skirt below the waist for a long coat, shoulders, head, hair.
    box(-0.2, 0.2, -0.13, 0.13, hem if hem > 0.8 else 0.9, 1.3, coat)
    if hem <= 0.8:
        box(-0.215, 0.215, -0.165, 0.165, hem, 0.92, coat)
    box(-0.24, 0.24, -0.14, 0.14, 1.3, 1.46, coat)
    box(-0.1, 0.1, -0.11, 0.11, 1.47, 1.69, skin)
    box(-0.11, 0.11, -0.12, 0.12, 1.62, 1.72, dark)            # hair

    # Free arm on the -X side: swings opposite the -X leg, i.e. with the +X leg (side +1).
    mb.limb = (shoulder, 0.0, 3)
    box(-0.275, -0.195, -0.05, 0.05, 0.78, shoulder + 0.04, coat)
    box(-0.265, -0.205, -0.04, 0.04, 0.69, 0.8, skin)          # hand
    mb.limb = None

    # Right arm raised to the umbrella handle in front of the shoulder, then the shaft.
    hx, hy = 0.17, -0.2
    box(hx - 0.05, hx + 0.05, hy - 0.05, -0.04, 1.16, 1.4, coat)
    box(hx - 0.015, hx + 0.015, hy - 0.015, hy + 0.015, 1.18, 2.1, metal)
    # Canopy: a shallow octagonal dome over the head, faces on both sides (seen from below).
    n, r = 8, ctx.p("radius", 0.55)
    cx, cy = hx * 0.55, hy * 0.55
    rim = [(cx + r * cos(tau * k / n), cy + r * sin(tau * k / n), 1.9) for k in range(n)]
    mid = [(cx + 0.62 * r * cos(tau * k / n), cy + 0.62 * r * sin(tau * k / n), 2.04) for k in range(n)]
    top = (cx, cy, 2.12)
    for k in range(n):
        j = (k + 1) % n
        for pts in ([rim[k], rim[j], mid[j], mid[k]], [mid[k], mid[j], top]):
            mb._face(pts, None, canopy[0], canopy[1], plan_uv)
            mb._face(pts[::-1], None, canopy[0], canopy[1], plan_uv)
    apex = 2.12
    mb.finish()
    ctx.meta.update(height=apex, footprint=[2 * r, 2 * r], shader="facade", family="walker",
                    gait={"hip": hip, "knee": knee})
