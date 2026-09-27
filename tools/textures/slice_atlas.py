"""Find the individual signs/ads in a generated atlas sheet: panels on a black background,
separated by dark gutters.

Recursive XY-cut: split the sheet along rows (then columns, alternating) whose pixels are
almost all near-black, recurse into each piece until nothing splits, then trim each piece to
its content. Works for grid-like sheets regardless of what is inside a panel (dark photos,
lettering on black), unlike blob detection. Pieces smaller than `min_size` are dropped.
"""
import numpy as np
from PIL import Image


def _runs(dark_line, min_gap):
    """[(start, end)] of content runs along one axis, splitting at >= min_gap dark lines."""
    runs, start, gap = [], None, 0
    for i, d in enumerate(dark_line):
        if d:
            gap += 1
            if start is not None and gap >= min_gap:
                runs.append((start, i - gap + 1))
                start = None
        else:
            if start is None:
                start = i
            gap = 0
    if start is not None:
        runs.append((start, len(dark_line) - gap))
    return runs


def _cut(dark, x0, y0, x1, y1, axis, min_gap, out, depth=0, tried=False):
    block = dark[y0:y1, x0:x1]
    line = block.mean(axis=1 - axis) > 0.97    # axis 0: rows, 1: columns
    runs = _runs(line, min_gap)
    if len(runs) <= 1:
        if tried:
            out.append((x0, y0, x1, y1))
            return
        # Trim to this run and try the other axis.
        if runs:
            a, b = runs[0]
            if axis == 0:
                y0, y1 = y0 + a, y0 + b
            else:
                x0, x1 = x0 + a, x0 + b
        _cut(dark, x0, y0, x1, y1, 1 - axis, min_gap, out, depth + 1, True)
        return
    for a, b in runs:
        if axis == 0:
            _cut(dark, x0, y0 + a, x1, y0 + b, 1, min_gap, out, depth + 1)
        else:
            _cut(dark, x0 + a, y0, x0 + b, y1, 0, min_gap, out, depth + 1)


def panels(im, thresh=0.1, min_gap=1, min_size=40):
    """Bounding boxes (x0, y0, x1, y1) of panels in pixels, reading order."""
    a = np.asarray(im.convert("RGB"), dtype=np.float32).max(axis=2) / 255.0
    dark = a < thresh
    out = []
    _cut(dark, 0, 0, a.shape[1], a.shape[0], 0, min_gap, out)
    boxes = [b for b in out if b[2] - b[0] >= min_size and b[3] - b[1] >= min_size]
    boxes.sort(key=lambda b: (round(b[1] / 40), b[0]))
    return [tuple(int(v) for v in b) for b in boxes]
