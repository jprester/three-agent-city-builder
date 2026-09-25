"""Facade-local coordinates for rectangular footprints.

Local space per facade: u runs left-to-right as seen from outside, y' points
INTO the building (so y' < 0 is in front of the wall), z is up. The wall plane
is at y' = 0. Side 0 = front (-Y), 1 = right (+X), 2 = back (+Y), 3 = left (-X)."""
import math


def facade_width(side: int, width: float, depth: float) -> float:
    return width if side % 2 == 0 else depth


def facade_xf(side: int, width: float, depth: float):
    half = depth / 2 if side % 2 == 0 else width / 2
    ang = side * math.pi / 2
    c, s = round(math.cos(ang)), round(math.sin(ang))

    def xf(x, y, z):
        y2 = y - half
        return (c * x - s * y2, s * x + c * y2, z)

    return xf
