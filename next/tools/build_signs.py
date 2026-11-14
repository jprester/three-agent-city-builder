"""The fresh slice's sign atlas: every board sized to its own text.

  python3 next/tools/build_signs.py        (npm run next:signs)

The main app's atlas (tools/textures/build_sign_designs.py) puts every word in a fixed slot per
class, so one character sits in a frame made for four. This builder reuses that module's
typesetting (fonts, masks, pictograms, part ids) and vocabulary (art/signs/designs.def.json), but
measures each design first and gives it a slot that fits, then packs the slots on shelves.
It also adds the kinds the slice places that the app has none of: multi-floor LED towers with a
bulb border, shopfront fascias across a whole frontage, and rooftop channel letters.

Source: next/signs.def.json (classes, style mix) + the app's vocabulary and fonts (read only).
Output: next/assets/signs.png + signs.json, preview build/previews/next-signs/designs.png.
Same channel packing as the app (R ink, G part id x coverage, B backlit face), so the slice's
sign shader is unchanged. Deterministic from the def's seed.
"""
import importlib.util
import json
import random
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('sign_designs', ROOT / 'tools/textures/build_sign_designs.py')
sd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sd)

DEF = ROOT / 'next/signs.def.json'
VOCAB = ROOT / 'art/signs/designs.def.json'
OUT = ROOT / 'next/assets'
PREVIEW = ROOT / 'build/previews/next-signs'


def pick_font(rng, fonts, text, heavy=False):
    usable = [f for f in fonts if sd.has_glyphs(f, text) and (not heavy or f.get('weight', 900) >= 900 or 'Dela' in f['file'])]
    usable = usable or [f for f in fonts if sd.has_glyphs(f, text)]
    weights = [f['share'] for f in usable]
    return rng.choices(usable, weights)[0]


def text_width(font, text, h):
    return sd.fit_text(font, text, 100000, h).width


# ---- vertical boards: blades and towers --------------------------------------------------

def blade(rng, word, jp, latin, style, w, tower=False):
    """Plan a vertical board for `word`, then return (height, draw)."""
    pad = w * 0.14
    lw = max(2.0, w * 0.03)
    n = len(sd.cells(word['jp']))
    cell = w - 2 * pad
    gap = cell * 0.1
    icon = word.get('icon') if word.get('icon') and rng.random() < (0.5 if tower else 0.35) else None
    clock = tower and not icon and rng.random() < 0.3
    en = word.get('en') if word.get('en') and rng.random() < 0.6 else None
    head = (cell * 0.9 + pad * 0.7) if (icon or clock) else 0
    foot = (w * 0.2 + pad * 0.9) if en else 0
    h = int(round(2 * pad + n * cell + (n - 1) * gap + head + foot + (pad * 0.6 if tower else 0)))
    boxed = style == 'box'
    border_r = w * (0.1 if rng.random() < 0.6 else 0.3)
    bordered = boxed and rng.random() < 0.5 or not boxed and rng.random() < 0.8

    def draw(slot):
        if boxed:
            slot.face(255, w * 0.06)
        if tower:
            # A run of bulbs round the edge, each its own part so single bulbs die.
            inset, step_ = pad * 0.45, w * 0.085
            pts = []
            for k in range(int((w - 2 * inset) / step_) + 1):
                pts += [(inset + k * step_, inset), (inset + k * step_, h - inset)]
            for k in range(1, int((h - 2 * inset) / step_)):
                pts += [(inset, inset + k * step_), (w - inset, inset + k * step_)]
            for x, y in pts:
                slot.ink(sd.lines_mask(w, h, [sd.circle(x, y, w * 0.018, n=8)], w * 0.022), 0, 0)
        elif bordered:
            slot.border(lw if not boxed else w * 0.06, lw * (1 if not boxed else 0.6), border_r)
        top, bottom = pad * (1.3 if tower else 1), h - pad * (1.3 if tower else 1)
        if icon:
            s = cell * 0.9
            slot.icon(icon, (w - s) / 2, top, s, lw)
            top += s + pad * 0.7
        elif clock:
            s = cell * 0.9
            slot.icon('clock', (w - s) / 2, top, s, lw * 1.2)
            top += s + pad * 0.7
        if en:
            ch = w * 0.2
            slot.centered(sd.fit_text(latin, en, w - 2 * pad, ch), w / 2, bottom - ch / 2)
            bottom -= ch + pad * 0.45
            slot.rule(pad, w - pad, bottom, lw * 0.6)
            bottom -= pad * 0.45
        sd.stack_vertical(slot, jp, word['jp'], pad, top, w - 2 * pad, bottom - top, 0.03 if style == 'outline' else 0)

    return h, draw


# ---- horizontal boards: panels, fascias, letters -------------------------------------------

def horizontal(rng, word, jp, latin, style, h, kind):
    """Plan a horizontal board sized to its text, then return (width, draw)."""
    quiet = style == 'plate'
    boxed = style in ('box', 'plate')
    letters = kind == 'letters'
    outline = 0.03 if style == 'outline' else 0
    lw = max(2.0, h * 0.045)
    pad = h * (0.06 if letters else 0.2 if quiet else 0.16)
    en = word.get('en') if word.get('en') and rng.random() < (0.45 if letters else 0.6) else None
    icon = word.get('icon') if not letters and word.get('icon') and rng.random() < 0.45 else None
    side_by_side = bool(en) and not letters and rng.random() < 0.35
    inner_h = h - 2 * pad
    main_h = inner_h if (not en or side_by_side) else inner_h * 0.7
    cs = sd.cells(word['jp'])
    # Characters are set one per cell with a little tracking, the way shop boards space them.
    track = 1.12 if kind == 'fascia' else 1.04
    chars = [sd.fit_text(jp, c, main_h, main_h, outline) for c in cs]
    main_w = sum(max(m.width, main_h * 0.55) for m in chars) + (len(cs) - 1) * main_h * (track - 1)
    sub = sd.fit_text(latin, en, 100000, inner_h * (0.42 if side_by_side else 0.24)) if en else None
    content = max(main_w, sub.width if sub and not side_by_side else 0)
    if side_by_side:
        content += pad * 1.2 + sub.width
    if icon:
        content += inner_h + pad
    w = int(round(max(content + 2 * pad * (1 if letters else 1.3), h * 1.25)))
    border = not boxed and not letters and rng.random() < 0.7
    border_r = h * (0.12 if rng.random() < 0.6 else 0.45)

    def draw(slot):
        if boxed:
            slot.face(105 if quiet else 255, h * 0.08)
        elif border:
            slot.border(lw, lw, border_r)
        x0 = (w - content) / 2
        if icon:
            s = inner_h
            slot.icon(icon, x0, pad, s, lw)
            x0 += s + pad
        y_main = pad + main_h / 2
        x = x0 + (content - (inner_h + pad if icon else 0) - (pad * 1.2 + sub.width if side_by_side else 0) - main_w) / 2
        for m in chars:
            cw = max(m.width, main_h * 0.55)
            slot.centered(m, x + cw / 2, y_main)
            x += cw + main_h * (track - 1)
        if sub and side_by_side:
            slot.vrule(x + pad * 0.4 - main_h * (track - 1), pad + 2, h - pad - 2, lw * 0.6)
            slot.centered(sub, x + pad * 0.8 + sub.width / 2, h / 2)
        elif sub:
            slot.centered(sub, x0 + (content - (inner_h + pad if icon else 0)) / 2, h - pad - sub.height / 2)

    return w, draw


def brand_blade(name, latin, w):
    """A brand set one Latin letter per cell down a framed column (the app's brand blade, sized to the name)."""
    h = int(round(len(name) * w * 0.62 + w * 0.5))
    return h, lambda slot: sd.draw_brand_blade(slot, None, name, latin)


def brand_letters(rng, name, latin, h):
    ch = h * 0.84
    ms = [sd.fit_text(latin, c, ch, ch) for c in name]
    trackw = [max(m.width, ch * 0.3) + ch * 0.12 for m in ms]
    w = int(round(sum(trackw) + h * 0.2))

    def draw(slot):
        x = h * 0.1
        for m, tw in zip(ms, trackw):
            slot.centered(m, x + tw / 2, h / 2)
            x += tw
    return w, draw


def build():
    cfg = json.loads(DEF.read_text())
    vocab = json.loads(VOCAB.read_text())
    rng = random.Random(cfg['seed'])
    G = cfg['atlas']['gutter']
    W = cfg['atlas']['width']
    latin = {'file': vocab['fonts']['latin']}
    jp_fonts = vocab['fonts']['jp']
    brands = vocab['brands']
    uses = {}
    planned = []   # (entry, w, h, draw, seed)
    brand_turn = 0
    for cls in cfg['classes']:
        kind = cls['kind']
        lo, hi = cls['cells']
        n_brand = cls.get('brands', 0)
        for i in range(cls['count']):
            entry = {'kind': kind, 'cls': cls['name'], 'boxed': False, 'dim': 1}
            if i < n_brand:
                name = brands[brand_turn % len(brands)]
                brand_turn += 1
                if kind in ('blade', 'tower'):
                    w = cls['width']
                    h, draw = brand_blade(name, latin, w)
                else:
                    h = cls['height']
                    w, draw = brand_letters(rng, name, latin, h)
                entry.update(brand=brands.index(name), text=name, style='neon')
            else:
                pool = [v for v in vocab['words'] if lo <= len(sd.cells(v['jp'])) <= hi]
                low = min(uses.get(v['jp'], 0) for v in pool)
                word = dict(rng.choice([v for v in pool if uses.get(v['jp'], 0) == low]))
                uses[word['jp']] = low + 1
                if kind == 'tower' and len(sd.cells(word['jp'])) < 4:
                    word['jp'] += rng.choice(cfg['towerSuffixes'])
                style = sd.choose(rng, cfg['styles'][kind])
                jp = pick_font(rng, jp_fonts, word['jp'], heavy=kind == 'letters')
                if style == 'tube':
                    jp = vocab['fonts']['tube']
                if kind in ('blade', 'tower'):
                    w = cls['width']
                    h, draw = blade(rng, word, jp, latin, style, w, kind == 'tower')
                else:
                    h = cls['height']
                    w, draw = horizontal(rng, word, jp, latin, style, h, kind)
                entry.update(boxed=style in ('box', 'plate'), dim=vocab['plateDim'] if style == 'plate' else 1, text=word['jp'], style=style, font=jp['file'])
            planned.append((entry, int(w), int(h), draw, rng.randrange(1 << 30)))

    # Shelf packing, tallest first.
    order = sorted(range(len(planned)), key=lambda k: -planned[k][2])
    x = y = row_h = 0
    places = {}
    for k in order:
        _, w, h, _, _ = planned[k]
        sw, sh = w + 2 * G, h + 2 * G
        if x + sw > W:
            x, y, row_h = 0, y + row_h, 0
        places[k] = (x + G, y + G)
        x += sw
        row_h = max(row_h, sh)
    H = int(np.ceil((y + row_h) / 256) * 256)
    atlas = np.zeros((H, W, 3), np.uint8)
    designs = []
    for k, (entry, w, h, draw, seed) in enumerate(planned):
        slot = sd.Slot(w, h, random.Random(seed))
        draw(slot)
        px, py = places[k]
        atlas[py:py + h, px:px + w, 0] = slot.r
        atlas[py:py + h, px:px + w, 1] = slot.g
        atlas[py:py + h, px:px + w, 2] = slot.b
        entry.update(px=[px, py, w, h], rect=[round(px / W, 6), round(1 - (py + h) / H, 6), round(w / W, 6), round(h / H, 6)], aspect=round(w / h, 5))
        designs.append(entry)
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas, 'RGB').save(OUT / 'signs.png', optimize=True)
    (OUT / 'signs.json').write_text(json.dumps({'size': [W, H], 'brands': brands, 'designs': designs}, ensure_ascii=False, indent=1) + '\n')
    PREVIEW.mkdir(parents=True, exist_ok=True)
    sd.PREVIEW = PREVIEW
    sd.preview(atlas, designs)
    kinds = {}
    for d in designs:
        kinds[d['kind']] = kinds.get(d['kind'], 0) + 1
    print(f'Slice signs: {len(designs)} ({", ".join(f"{k} {v}" for k, v in kinds.items())}), atlas {W}x{H}.')


if __name__ == '__main__':
    build()
