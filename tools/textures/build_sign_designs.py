"""Typeset sign designs: real trade words set in bundled fonts, baked into one data atlas.

  python3 tools/textures/build_sign_designs.py        (npm run signs:designs)

Source: art/signs/designs.def.json (vocabulary, fonts, slot classes, style mix).
Output: art/textures/signs/designs.png + designs.json, preview in build/previews/signs/.

The atlas holds data, not colour; the sign shader colours each instance:
  R  ink / tube coverage
  G  part id x coverage (one id per character, border or icon) for dead and flickering parts
  B  backlit face area (lightboxes 255, quiet printed plates 105)
Glow is read from a coarse mip of R, so every slot keeps an empty gutter.
Deterministic: all randomness comes from the def's seed.
"""
import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
DEF = ROOT / 'art/signs/designs.def.json'
OUT = ROOT / 'art/textures/signs'
PREVIEW = ROOT / 'build/previews/signs'
FONTS = ROOT / 'art/external/fonts'
SS = 4  # supersampling for line work

_font_cache = {}


def load_font(spec, size):
    key = (spec['file'], spec.get('weight'), int(size))
    if key not in _font_cache:
        f = ImageFont.truetype(str(FONTS / spec['file']), max(6, int(size)))
        if spec.get('weight'):
            f.set_variation_by_axes([spec['weight']])
        _font_cache[key] = f
    return _font_cache[key]


def has_glyphs(spec, text):
    """True when the font draws every character (a missing glyph renders as .notdef)."""
    f = load_font(spec, 40)
    missing = f.getmask('￿').getbbox()
    for ch in text:
        m = f.getmask(ch)
        if m.getbbox() is None:
            return False
        if missing and m.size == f.getmask('￿').size and bytes(m) == bytes(f.getmask('￿')):
            return False
    return True


def text_mask(spec, value, size, outline=0):
    """Tight antialiased mask of `value`. outline > 0 gives a tube following the letter edge."""
    f = load_font(spec, size)
    pad = int(size * 0.3) + outline + 2
    l, t, r, b = f.getbbox(value)
    img = Image.new('L', (r - l + 2 * pad, b - t + 2 * pad), 0)
    d = ImageDraw.Draw(img)
    if outline:
        d.text((pad - l, pad - t), value, font=f, fill=255, stroke_width=outline, stroke_fill=255)
        inner = Image.new('L', img.size, 0)
        ImageDraw.Draw(inner).text((pad - l, pad - t), value, font=f, fill=255)
        img = Image.fromarray(np.clip(np.asarray(img).astype(int) - np.asarray(inner).astype(int), 0, 255).astype(np.uint8))
    else:
        d.text((pad - l, pad - t), value, font=f, fill=255)
    box = img.getbbox()
    return img.crop(box) if box else Image.new('L', (1, 1), 0)


def fit_text(spec, value, w, h, outline_ratio=0.0):
    """Largest mask of `value` that fits w x h."""
    size = h * 1.25
    while size > 6:
        m = text_mask(spec, value, size, max(1, round(size * outline_ratio)) if outline_ratio else 0)
        if m.width <= w and m.height <= h:
            return m
        size *= min(0.97, max(0.6, min(w / m.width, h / m.height)))
    return text_mask(spec, value, 6)


# ---- pictograms: polylines in a unit box, y down
def circle(cx, cy, r, a0=0.0, a1=math.tau, n=20):
    return [(cx + math.cos(a0 + (a1 - a0) * k / n) * r, cy + math.sin(a0 + (a1 - a0) * k / n) * r) for k in range(n + 1)]


STEAM = [[(a, .36), (a - .04, .26), (a + .04, .15), (a, .05)] for a in (.3, .5, .7)]
ICONS = {
    'ramen': [[(.08, .55), (.92, .55)], circle(.5, .55, .42, 0, math.pi, 14), [(.62, .52), (.95, .1)], [(.7, .52), (.98, .18)],
              [(.32, .4), (.28, .3), (.34, .2), (.3, .1)], [(.46, .4), (.42, .3), (.48, .2), (.44, .1)]],
    'torii': [[(.02, .14), (.2, .2), (.5, .22), (.8, .2), (.98, .14)], [(.12, .34), (.88, .34)], [(.24, .2), (.2, .98)], [(.76, .2), (.8, .98)], [(.5, .22), (.5, .34)]],
    'koi': [[(.1, .5), (.3, .3), (.6, .28), (.78, .45), (.6, .62), (.3, .66), (.1, .5)], [(.78, .45), (.98, .25), (.92, .48), (.98, .7), (.78, .45)],
            [(.4, .3), (.5, .14), (.56, .29)], circle(.24, .47, .035, n=8)],
    'martini': [[(.1, .12), (.9, .12), (.5, .58), (.1, .12)], [(.5, .58), (.5, .9)], [(.3, .92), (.7, .92)], [(.62, .3), (.8, .05)], circle(.58, .34, .06, n=10)],
    'cat': [circle(.5, .55, .3), [(.26, .38), (.28, .12), (.44, .27)], [(.56, .27), (.72, .12), (.74, .38)], [(.8, .5), (.86, .26), (.95, .22)],
            circle(.4, .52, .04, n=8), circle(.6, .52, .04, n=8)],
    'dice': [[(.14, .14), (.86, .14), (.86, .86), (.14, .86), (.14, .14)], circle(.32, .32, .06, n=8), circle(.5, .5, .06, n=8), circle(.68, .68, .06, n=8)],
    'pill': [[(.3, .1), (.7, .1), (.7, .9), (.3, .9), (.3, .1)], [(.5, .25), (.5, .75)], [(.25, .5), (.75, .5)]],
    'cup': STEAM + [[(.12, .48), (.25, .84), (.75, .84), (.88, .48), (.12, .48)], [(.2, .95), (.8, .95)], circle(.88, .62, .12, -math.pi / 2, math.pi / 2, 10)],
    'steam': STEAM + [circle(.5, .68, .4, 0, math.pi, 14), [(.1, .68), (.9, .68)]],
    'cross': [[(.4, .08), (.6, .08), (.6, .4), (.92, .4), (.92, .6), (.6, .6), (.6, .92), (.4, .92), (.4, .6), (.08, .6), (.08, .4), (.4, .4), (.4, .08)]],
    'key': [circle(.36, .34, .26), [(.54, .54), (.9, .9)], [(.9, .9), (.98, .82)], [(.78, .78), (.86, .7)]],
    'game': [[(.2, .3), (.8, .3), (.96, .8), (.76, .84), (.64, .64), (.36, .64), (.24, .84), (.04, .8), (.2, .3)], [(.2, .47), (.4, .47)], [(.3, .37), (.3, .57)],
             circle(.7, .46, .035, n=8), circle(.8, .55, .035, n=8)],
    'laundry': [[(.12, .08), (.88, .08), (.88, .94), (.12, .94), (.12, .08)], [(.12, .26), (.88, .26)], circle(.5, .58, .22), circle(.72, .17, .03, n=8)],
    'clock': [circle(.5, .5, .42), [(.5, .2), (.5, .5), (.72, .6)]],
    'arrow': [[(.1, .5), (.9, .5)], [(.6, .2), (.9, .5), (.6, .8)]],
    'wave': [[(.15 + i * .17, .5 - h / 2), (.15 + i * .17, .5 + h / 2)] for i, h in enumerate([.3, .6, .9, .5, .7])],
}


def lines_mask(w, h, polylines, width):
    """Antialiased polylines (pixel coords) on a w x h mask."""
    img = Image.new('L', (int(w) * SS, int(h) * SS), 0)
    d = ImageDraw.Draw(img)
    lw = max(1, round(width * SS))
    for pts in polylines:
        p = [(x * SS, y * SS) for x, y in pts]
        d.line(p, fill=255, width=lw, joint='curve')
        for x, y in (p[0], p[-1]):
            d.ellipse((x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2), fill=255)
    return img.resize((int(w), int(h)), Image.LANCZOS)


def rounded_mask(w, h, radius, width=0):
    """Filled rounded rect, or a tube of `width` when given."""
    img = Image.new('L', (int(w) * SS, int(h) * SS), 0)
    d = ImageDraw.Draw(img)
    if width:
        m = width * SS / 2
        d.rounded_rectangle((m, m, w * SS - 1 - m, h * SS - 1 - m), radius=radius * SS, outline=255, width=max(1, round(width * SS)))
    else:
        d.rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), radius=radius * SS, fill=255)
    return img.resize((int(w), int(h)), Image.LANCZOS)


class Slot:
    """One design's pixels: ink parts with ids, and the backlit face."""

    def __init__(self, w, h, rng):
        self.w, self.h, self.rng = w, h, rng
        self.r = np.zeros((h, w), np.uint8)
        self.g = np.zeros((h, w), np.uint8)
        self.b = np.zeros((h, w), np.uint8)

    def ink(self, mask, x, y):
        """Stamp a part at (x, y) with a fresh id."""
        m = np.asarray(mask)
        x, y = int(round(x)), int(round(y))
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.w, x + m.shape[1]), min(self.h, y + m.shape[0])
        if x1 <= x0 or y1 <= y0:
            return
        m = m[y0 - y:y1 - y, x0 - x:x1 - x]
        part = 40 + self.rng.randrange(215)
        r = self.r[y0:y1, x0:x1]
        g = self.g[y0:y1, x0:x1]
        win = m > r
        g[win] = (m[win].astype(np.uint16) * part // 255).astype(np.uint8)
        r[win] = m[win]

    def centered(self, mask, cx, cy):
        self.ink(mask, cx - mask.width / 2, cy - mask.height / 2)

    def face(self, level, radius):
        self.b = (np.asarray(rounded_mask(self.w, self.h, radius)).astype(np.uint16) * level // 255).astype(np.uint8)

    def border(self, inset, width, radius):
        self.ink(rounded_mask(self.w - 2 * inset, self.h - 2 * inset, radius, width), inset, inset)

    def rule(self, x0, x1, y, width):
        self.ink(lines_mask(self.w, self.h, [[(x0, y), (x1, y)]], width), 0, 0)

    def vrule(self, x, y0, y1, width):
        self.ink(lines_mask(self.w, self.h, [[(x, y0), (x, y1)]], width), 0, 0)

    def icon(self, name, x, y, s, width):
        self.ink(lines_mask(self.w, self.h, [[(x + px * s, y + py * s) for px, py in line] for line in ICONS[name]], width), 0, 0)


def cells(text):
    """Vertical-setting cells: one per character, runs of Latin/digits kept upright together."""
    out, run = [], ''
    for ch in text:
        if ch.isascii() and ch.isalnum():
            run += ch
            continue
        if run:
            out.append(run)
            run = ''
        out.append(ch)
    if run:
        out.append(run)
    return out


def stack_vertical(slot, spec, text, x0, y0, w, h, outline):
    """Characters stacked down a column, each in a square cell, spread to fill the height."""
    cs = cells(text)
    cell = min(w, h / len(cs))
    gap = min((h - cell * len(cs)) / max(1, len(cs) - 1), cell * 0.45) if len(cs) > 1 else 0
    top = y0 + (h - cell * len(cs) - gap * (len(cs) - 1)) / 2
    for i, c in enumerate(cs):
        m = fit_text(spec, 'ー' if c == 'ー' else c, cell * 0.94, cell * 0.94, outline)
        if c == 'ー':  # the long-vowel mark stands upright in vertical setting
            m = m.rotate(90, expand=True)
        slot.centered(m, x0 + w / 2, top + i * (cell + gap) + cell / 2)


def choose(rng, table):
    r = rng.random() * sum(table.values())
    for k, v in table.items():
        r -= v
        if r <= 0:
            return k
    return k


def draw_blade(slot, rng, word, jp, latin, style):
    w, h = slot.w, slot.h
    boxed = style == 'box'
    outline = 0.03 if style == 'outline' else 0
    lw = max(2.0, w * 0.03)
    pad = w * 0.14
    if boxed:
        slot.face(255, w * 0.06)
        if rng.random() < 0.5:
            slot.border(w * 0.06, lw * 0.6, w * 0.04)
    elif rng.random() < 0.75:
        slot.border(lw, lw, w * (0.1 if rng.random() < 0.6 else 0.3))
    top, bottom = pad, h - pad
    n = len(cells(word['jp']))
    room = h - 2 * pad - n * (w - 2 * pad)
    # Spare height goes to a pictogram on top and/or a Latin caption at the foot.
    if word.get('icon') and room > w * 0.75 and rng.random() < 0.75:
        s = w - 2 * pad - w * 0.08
        slot.icon(word['icon'], (w - s) / 2, top, s, lw)
        top += s + pad * 0.7
        room -= s + pad * 0.7
    if word.get('en') and room > w * 0.3 and rng.random() < 0.7:
        ch = w * 0.2
        m = fit_text(latin, word['en'], w - 2 * pad, ch)
        slot.centered(m, w / 2, bottom - ch / 2)
        bottom -= ch + pad * 0.45
        slot.rule(pad, w - pad, bottom, lw * 0.6)
        bottom -= pad * 0.45
    stack_vertical(slot, jp, word['jp'], pad, top, w - 2 * pad, bottom - top, outline)


def draw_panel(slot, rng, word, jp, latin, style):
    w, h = slot.w, slot.h
    quiet = style == 'plate'
    boxed = style in ('box', 'plate')
    outline = 0.03 if style == 'outline' else 0
    lw = max(2.0, h * 0.045)
    pad = h * (0.2 if quiet else 0.16)
    if boxed:
        slot.face(105 if quiet else 255, h * 0.08)
    elif rng.random() < 0.7:
        slot.border(lw, lw, h * (0.12 if rng.random() < 0.6 else 0.45))
    x0, x1 = pad * 1.3, w - pad * 1.3
    if word.get('icon') and (x1 - x0) > h * 2.2 and rng.random() < 0.6:
        s = h - 2 * pad
        if rng.random() < 0.5:
            slot.icon(word['icon'], x0, pad, s, lw)
            x0 += s + pad
        else:
            slot.icon(word['icon'], x1 - s, pad, s, lw)
            x1 -= s + pad
    en = word.get('en')
    y0, y1 = pad, h - pad
    lead_en = bool(en) and rng.random() < 0.22 and (x1 - x0) > h * 2
    main, sub = (en, word['jp']) if lead_en else (word['jp'], en)
    main_font, sub_font = (latin, jp) if lead_en else (jp, latin)
    if sub and rng.random() < 0.6:
        if (x1 - x0) > h * 3.2 and rng.random() < 0.5:
            # Side by side, a tube between them.
            mw = (x1 - x0) * 0.58
            slot.centered(fit_text(main_font, main, mw - pad, y1 - y0, 0 if lead_en else outline), x0 + mw / 2, h / 2)
            slot.vrule(x0 + mw + pad * 0.2, y0 + 2, y1 - 2, lw * 0.6)
            slot.centered(fit_text(sub_font, sub, x1 - x0 - mw - pad * 1.2, (y1 - y0) * 0.5), x0 + mw + pad * 0.6 + (x1 - x0 - mw - pad * 0.6) / 2, h / 2)
            return
        # Two lines: the main word over a small caption.
        sh = (y1 - y0) * 0.26
        slot.centered(fit_text(sub_font, sub, x1 - x0, sh), (x0 + x1) / 2, y1 - sh / 2)
        y1 -= sh + pad * 0.4
    m = fit_text(main_font, main, x1 - x0, y1 - y0, 0 if lead_en else outline)
    # A short word on a long board is tracked out, character by character, to fill it.
    cs = cells(main) if not lead_en else [main]
    if len(cs) > 1 and m.width < (x1 - x0) * 0.62:
        cell = y1 - y0
        step = min((x1 - x0 - cell) / (len(cs) - 1), cell * 1.9)
        left = (x0 + x1) / 2 - step * (len(cs) - 1) / 2
        for i, c in enumerate(cs):
            slot.centered(fit_text(main_font, c, cell, cell, outline), left + i * step, (y0 + y1) / 2)
    else:
        slot.centered(m, (x0 + x1) / 2, (y0 + y1) / 2)


def draw_brand_blade(slot, rng, name, latin):
    w, h = slot.w, slot.h
    lw = max(2.0, w * 0.035)
    slot.border(lw, lw, w * 0.2)
    cell = min((h - w * 0.5) / len(name), w * 0.8)
    top = (h - cell * len(name)) / 2
    for i, c in enumerate(name):
        slot.centered(fit_text(latin, c, w * 0.62, cell * 0.82), w / 2, top + i * cell + cell / 2)


def draw_brand_wordmark(slot, rng, name, latin):
    w, h = slot.w, slot.h
    ch = h * 0.7
    track = min(ch * 0.9, (w - 20) / len(name))
    left = (w - track * len(name)) / 2
    for i, c in enumerate(name):
        slot.centered(fit_text(latin, c, track * 0.9, ch), left + i * track + track / 2, h * 0.06 + ch / 2)
    slot.rule(w * 0.15, w * 0.85, h * 0.9, h * 0.05)


def build():
    cfg = json.loads(DEF.read_text())
    rng = random.Random(cfg['seed'])
    W, H, G = cfg['atlas']['width'], cfg['atlas']['height'], cfg['atlas']['gutter']
    atlas = np.zeros((H, W, 3), np.uint8)
    latin = {'file': cfg['fonts']['latin']}
    jp_fonts = cfg['fonts']['jp']
    brands = cfg['brands']
    designs = []
    uses = {}
    x = y = row_h = 0
    for cls in cfg['classes']:
        iw, ih = cls['inner']
        sw, sh = iw + 2 * G, ih + 2 * G
        if x:  # each class starts a fresh shelf
            x, y = 0, y + row_h
        row_h = sh
        blade = cls['kind'] == 'blade'
        cells_fit = (ih - 2 * iw * 0.14) / (iw * 0.72) if blade else (iw / ih) * 1.25
        n_plain = cls['count'] - (len(brands) if cls.get('brands') else 0)
        for i in range(cls['count']):
            if x + sw > W:
                x, y = 0, y + sh
            if y + sh > H:
                raise SystemExit(f'Sign design atlas overflow in class {cls["name"]}: raise atlas.height or lower counts.')
            slot = Slot(iw, ih, rng)
            entry = {'kind': cls['kind'], 'cls': cls['name'], 'boxed': False, 'dim': 1}
            if i >= n_plain:
                brand = i - n_plain
                (draw_brand_blade if blade else draw_brand_wordmark)(slot, rng, brands[brand], latin)
                entry.update(brand=brand, text=brands[brand])
            else:
                # Words that fit this board, least used first so the vocabulary is spread.
                pool = [w for w in cfg['words'] if len(cells(w['jp'])) <= cells_fit and (blade or len(w['jp']) >= 1)]
                if blade and ih / iw > 3:
                    pool = [w for w in pool if len(cells(w['jp'])) >= 2] or pool
                low = min(uses.get(w['jp'], 0) for w in pool)
                word = rng.choice([w for w in pool if uses.get(w['jp'], 0) == low])
                uses[word['jp']] = low + 1
                style = choose(rng, cfg['styles'][cls['kind']])
                fonts = [f for f in jp_fonts if has_glyphs(f, word['jp'])]
                jp = fonts[[k for k in range(len(fonts)) for _ in range(int(fonts[k]['share'] * 100))][rng.randrange(sum(int(f['share'] * 100) for f in fonts))]]
                if style == 'tube':  # bent-glass neon: thin strokes of even weight
                    jp = cfg['fonts']['tube']
                (draw_blade if blade else draw_panel)(slot, rng, word, jp, latin, style)
                entry.update(boxed=style in ('box', 'plate'), dim=cfg['plateDim'] if style == 'plate' else 1, text=word['jp'], style=style, font=jp['file'])
            px, py = x + G, y + G
            atlas[py:py + ih, px:px + iw, 0] = slot.r
            atlas[py:py + ih, px:px + iw, 1] = slot.g
            atlas[py:py + ih, px:px + iw, 2] = slot.b
            entry.update(px=[px, py, iw, ih], rect=[round(px / W, 6), round(1 - (py + ih) / H, 6), round(iw / W, 6), round(ih / H, 6)], aspect=round(iw / ih, 5))
            designs.append(entry)
            x += sw
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas, 'RGB').save(OUT / 'designs.png', optimize=True)
    (OUT / 'designs.json').write_text(json.dumps({'size': [W, H], 'brands': brands, 'designs': designs}, ensure_ascii=False, indent=1) + '\n')
    preview(atlas, designs)
    kinds = {}
    for d in designs:
        kinds[d['cls']] = kinds.get(d['cls'], 0) + 1
    print(f'Sign designs: {len(designs)} ({", ".join(f"{k} {v}" for k, v in kinds.items())}); {len(uses)} of {len(cfg["words"])} words used.')


def preview(atlas, designs):
    """Contact sheet as the shader would show them: neon on dark, lightboxes lit."""
    PREVIEW.mkdir(parents=True, exist_ok=True)
    palette = json.loads((ROOT / 'art/style/palette.json').read_text())
    hexc = lambda n: np.array([int(palette[n].lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)], float)
    tubes = [hexc(n) for n in ('sign_red', 'sign_amber', 'tungsten', 'fluorescent', 'sign_cyan', 'sodium')]
    a = atlas.astype(float) / 255
    out = np.zeros(atlas.shape, float) + np.array([14, 15, 20])
    for i, d in enumerate(designs):
        px, py, w, h = d['px']
        r, b = a[py:py + h, px:px + w, 0:1], a[py:py + h, px:px + w, 2:3]
        tube = tubes[i % len(tubes)]
        if d['boxed']:
            face = hexc('fluorescent') * 0.8 * d['dim'] if i % 2 else tube * 0.75 * d['dim']
            ink = np.array([20, 20, 24]) if i % 2 else np.array([255, 250, 240])
            out[py:py + h, px:px + w] = out[py:py + h, px:px + w] * (1 - b) + b * face
            out[py:py + h, px:px + w] = out[py:py + h, px:px + w] * (1 - r) + r * ink
        else:
            out[py:py + h, px:px + w] = out[py:py + h, px:px + w] * (1 - r) + r * (tube * 0.75 + 64)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGB').save(PREVIEW / 'designs.png')


if __name__ == '__main__':
    build()
