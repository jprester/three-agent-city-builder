"""The city's signs and ads, from one def and one style (docs/ADS-PLAN.md).

    python3 tools/textures/build_signs.py --render [pattern]   render missing takes (Z-Image Turbo, `img`)
    python3 tools/textures/build_signs.py --sheet               contact sheets for review
    python3 tools/textures/build_signs.py                       pack atlases + catalog
    then: npm run textures && npm run layouts

Source: art/signs/signs.def.json. Every sign belongs to a business (a tenant at a fixed floor:
fascia, blade, tenant panel, upper-wall billboard; Hong Kong neon overhang and blade) or a brand
(rooftop/tower campaigns, screens, crown lettering). A sign's id is `<owner>.<format>`.

Takes: build/signs-takes/<id>-<seed>.png (local, not committed; re-render from the def). Each
take is cropped to its sign (the bright box on the black background; brand photos are full
bleed) and stored in art/external/signs/<id>.webp, committed: those are the sources the packer
reads. Brand boards are composed here: the photo plus the brand's wordmark, set in a bundled font
(Z-Image garbles multi-word English), so a brand's name is identical everywhere.

Outputs (art/textures/signs/): signs_0..N.webp (shelf-packed, RGB colour, alpha = emission mask,
not opacity; 4096 max), screens.webp (portrait campaigns in a uniform 2:3 grid for the facade
screens), catalog.json (per sign: owner, format, floor, atlas, UV rect, aspect, light colour,
gain, holo), preview build/previews/signs/*.png.
"""
import colorsys
import fnmatch
import hashlib
import json
import zlib
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
DEF = ROOT / 'art' / 'signs' / 'signs.def.json'
TAKES = ROOT / 'build' / 'signs-takes'
SRC = ROOT / 'art' / 'external' / 'signs'
OUT = ROOT / 'art' / 'textures' / 'signs'
PREVIEW = ROOT / 'build' / 'previews' / 'signs'
FONTS = ROOT / 'art' / 'external' / 'fonts'
ATLAS = 4096
MAX_ATLASES = 4          # the sign shaders bind four atlases
GAP = 6                  # px between packed images (edge-extruded, for mip filtering)
# Longest edge in the atlas per format: blades are seen up close, tenant panels are small.
SCALE = {'fascia': 1024, 'blade': 768, 'panel': 448, 'billboard': 896, 'overhang': 896, 'hkblade': 768,
         'board': 1024, 'wide': 1024, 'tall': 768, 'mark': 1024}
GAIN = {'lightbox': 1.05, 'neon': 1.9, 'billboard': 0.9, 'brand': 1.0, 'mark': 2.2}


def load():
    return json.loads(DEF.read_text())


def items(d):
    """Every sign: dict(id, owner, kind 'business'|'brand', format, prompt, size, seed)."""
    out = []
    bg = d['background']
    for b in d['businesses']:
        if b['script'] == 'zh':
            fmts = ['overhang', 'hkblade']
        elif b['floor'] == 1:
            fmts = ['fascia', 'blade']
        else:
            fmts = ['panel', 'blade'] + (['billboard'] if b.get('billboard') else [])
        for f in b.get('only', fmts):
            F = d['formats'][f]
            floor = f"{b['floor']}F"
            extra = ''
            if b.get('icon') and f in ('fascia', 'panel'):
                extra += f", {b['icon']}"
            if b['floor'] > 1 and f == 'blade':
                extra += f" and below it a badge reading {floor}"
            if b['floor'] > 1 and f == 'panel':
                extra += f" and below it a large floor number {floor}"
            extra += b.get('extra', '') if f in ('overhang', 'hkblade') else ''
            shape = F.get('shape', '')
            chars = [c for c in b['text'] if not c.isspace()]
            if F.get('vertical'):
                # Tall boards invite repeated characters: say how many, and size the board to them.
                extra = f" written once from top to bottom, exactly {len(chars)} characters, each appearing only once" + extra
            p = d['styles'][F['style']].format(shape=shape, trade=b['trade'], face=b.get('face', ''), ink=b['ink'],
                                               text=b['text'], extra=extra, border=b.get('border', ''),
                                               photo=b.get('billboard', ''), floor=floor)
            size = list(F['size'])
            if F.get('vertical'):
                n = len(chars) + (1 if b['floor'] > 1 and f == 'blade' else 0)
                size = [384 if b.get('tall') else 512, min(1536, 448 + 224 * n)]
            back = bg.replace(', no people', '') if F['style'] == 'billboard' else bg
            out.append(dict(id=f"{b['id']}.{f}", owner=b['id'], kind='business', format=f, style=F['style'],
                            prompt=f'{p}, {back}', size=size, floor=b['floor'], script=b['script']))
    for b in d['brands']:
        for f in ('land', 'tall'):
            F = d['formats'][f]
            out.append(dict(id=f"{b['id']}.{f}", owner=b['id'], kind='brand', format=f, style='brand',
                            prompt=d['styles']['brand'].format(art=b[f]), size=list(F['size'])))
    for it in out:
        # Pinned seeds; a new sign's default depends on its id only, never on its place in the list.
        it['seed'] = d['seeds'].get(it['id'], d['seed'] + zlib.crc32(it['id'].encode()) % 100000)
    return out


TAKES_JSON = SRC / 'takes.json'


def take_path(it):
    """Local render of a sign: id, seed and a hash of its prompt and size (a changed prompt is a new take)."""
    h = hashlib.sha1(json.dumps([it['prompt'], it['size']], ensure_ascii=False).encode()).hexdigest()[:8]
    return TAKES / f"{it['id']}-{it['seed']}-{h}.png"


def load_takes():
    """The exact prompt, size and seed each committed source was rendered from."""
    return json.loads(TAKES_JSON.read_text()) if TAKES_JSON.exists() else {}


def run_img(it, t):
    subprocess.run(['img', it['prompt'], '-W', str(it['size'][0]), '-H', str(it['size'][1]),
                    '-s', str(it['seed']), '-o', str(t)], check=True, stdout=subprocess.DEVNULL)


def crop_sign(im, style):
    """The sign itself: bounding box of everything brighter than the black background, plus a
    small margin. Brand photos are full bleed and stay whole."""
    if style == 'brand':
        return im
    a = np.asarray(im.convert('RGB'), dtype=np.float32).max(axis=2) / 255.0
    thresh = 0.16 if style == 'neon' else 0.22
    rows, cols = np.where(a.max(axis=1) > thresh)[0], np.where(a.max(axis=0) > thresh)[0]
    if not len(rows) or not len(cols):
        return im
    m = 10
    box = (max(0, cols[0] - m), max(0, rows[0] - m), min(im.width, cols[-1] + 1 + m), min(im.height, rows[-1] + 1 + m))
    return im.crop(box)


def render(pattern):
    """Render every sign matching `pattern` whose source is missing or was made from another seed
    than the def now gives (re-roll: pin a new seed), with the def's current prompt; record what
    each source was made from in takes.json (a prompt edit alone keeps existing picks)."""
    d = load()
    TAKES.mkdir(parents=True, exist_ok=True)
    SRC.mkdir(parents=True, exist_ok=True)
    ids = {it['id'] for it in items(d)}
    takes = {k: v for k, v in load_takes().items() if k in ids}   # retired signs
    rec = lambda it: {'seed': it['seed'], 'size': it['size'], 'prompt': it['prompt']}
    todo = [it for it in items(d) if fnmatch.fnmatch(it['id'], pattern)
            and not ((SRC / f"{it['id']}.webp").exists() and takes.get(it['id'], {}).get('seed') == it['seed'])]
    for n, it in enumerate(todo):
        t = take_path(it)
        if not t.exists():
            print(f"[{n + 1}/{len(todo)}] {it['id']} seed {it['seed']}", flush=True)
            run_img(it, t)
        crop_sign(Image.open(t).convert('RGB'), it['style']).save(SRC / f"{it['id']}.webp", quality=92, method=6)
        takes[it['id']] = rec(it)
        TAKES_JSON.write_text(json.dumps(takes, ensure_ascii=False, indent=1) + '\n')


def sheet():
    """Contact sheets of the cropped sources, labelled, for checking text and style."""
    d = load()
    PREVIEW.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(str(FONTS / 'NotoSansJP.ttf'), 18)
    groups = {}
    for it in items(d):
        groups.setdefault(it['format'], []).append(it)
    for fmt, its in groups.items():
        cell = (300, 420) if fmt in ('blade', 'hkblade', 'tall') else (520, 300)
        cols = 8 if cell[0] == 300 else 4
        rows = (len(its) + cols - 1) // cols
        im = Image.new('RGB', (cols * cell[0], rows * cell[1]), (45, 45, 48))
        dr = ImageDraw.Draw(im)
        for k, it in enumerate(its):
            x, y = (k % cols) * cell[0], (k // cols) * cell[1]
            src = SRC / f"{it['id']}.webp"
            label = f"{it['id']} s{load_takes().get(it['id'], {}).get('seed', '?')}"
            if src.exists():
                s = Image.open(src).convert('RGB')
                s.thumbnail((cell[0] - 12, cell[1] - 34))
                im.paste(s, (x + 6, y + 30))
            else:
                label += ' (missing)'
            dr.text((x + 6, y + 4), label, fill=(230, 230, 230), font=font)
        im.save(PREVIEW / f'sources-{fmt}.png')
        print('wrote', PREVIEW / f'sources-{fmt}.png')


# ---- brand composition -------------------------------------------------------------------

def brand_font(brand, size):
    f = 'NotoSansJP.ttf' if brand.get('jp') else 'BarlowCondensed-SemiBold.ttf'
    font = ImageFont.truetype(str(FONTS / f), size)
    if brand.get('jp'):
        try:
            font.set_variation_by_axes([900])
        except Exception:
            pass
    return font


def fit_text(brand, text, max_w, max_h):
    size = int(max_h)
    while size > 8:
        font = brand_font(brand, size)
        l, t, r, b = font.getbbox(text)
        if r - l <= max_w and b - t <= max_h:
            return font, (l, t, r, b)
        size = int(size * 0.92)
    font = brand_font(brand, 8)
    return font, font.getbbox(text)


def cover(im, w, h, focus=(0.5, 0.5)):
    """Scale and crop `im` to fill w x h."""
    s = max(w / im.width, h / im.height)
    r = im.resize((max(w, round(im.width * s)), max(h, round(im.height * s))), Image.LANCZOS)
    x = round((r.width - w) * focus[0])
    y = round((r.height - h) * focus[1])
    return r.crop((x, y, x + w, y + h))


def compose_board(brand, photo, w, h, layout):
    """Campaign board: the photo with a dark band carrying the wordmark (and tagline).
    layout 'side': band on the right third (wide boards); 'foot': band along the bottom (tall)."""
    im = cover(photo, w, h, (0.35, 0.5) if layout == 'side' else (0.5, 0.4)).convert('RGB')
    band = Image.new('RGB', (w, h), (8, 8, 10))
    mask = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(mask)
    if layout == 'side':
        bx = int(w * 0.64)
        md.rectangle((bx, 0, w, h), fill=235)
        area = (bx + int(w * 0.03), int(h * 0.18), w - int(w * 0.03), int(h * 0.82))
    else:
        by = int(h * 0.80)
        md.rectangle((0, by, w, h), fill=235)
        area = (int(w * 0.08), by + int(h * 0.025), w - int(w * 0.08), h - int(h * 0.025))
    mask = mask.filter(ImageFilter.GaussianBlur(max(2, w // 200)))
    im = Image.composite(band, im, mask)
    dr = ImageDraw.Draw(im)
    ax0, ay0, ax1, ay1 = area
    tag = brand.get('tagline') or ''
    name_h = (ay1 - ay0) * (0.62 if tag else 0.9)
    font, (l, t, r, b) = fit_text(brand, brand['name'], ax1 - ax0, name_h)
    cx = (ax0 + ax1) / 2
    ny = ay0 + (name_h - (b - t)) / 2
    dr.text((cx - (r - l) / 2 - l, ny - t), brand['name'], font=font, fill=tuple(brand['colour']))
    if tag:
        tb_h = (ay1 - ay0) * 0.24
        tfont, (tl, tt, tr, tbb) = fit_text({'jp': brand.get('jp')}, tag, (ax1 - ax0) * 0.8, tb_h)
        ty = ay0 + name_h + (ay1 - ay0 - name_h - (tbb - tt)) / 2
        dr.text((cx - (tr - tl) / 2 - tl, ty - tt), tag, font=tfont, fill=tuple(brand['accent']))
    return im


def compose_mark(brand, h=200):
    """Crown lettering: the wordmark alone as lit channel letters on black (drawn additive)."""
    font = brand_font(brand, h)
    l, t, r, b = font.getbbox(brand['name'])
    pad = h // 4
    w, hh = r - l + 2 * pad, b - t + 2 * pad
    ink = Image.new('L', (w, hh), 0)
    ImageDraw.Draw(ink).text((pad - l, pad - t), brand['name'], font=font, fill=255)
    col = np.array(brand['accent'], dtype=np.float32) / 255.0
    core = np.asarray(ink, dtype=np.float32)[..., None] / 255.0
    glow = np.asarray(ink.filter(ImageFilter.GaussianBlur(h / 14)), dtype=np.float32)[..., None] / 255.0
    rgb = core * (col * 0.35 + 0.65) + glow * col * 0.55
    return Image.fromarray(np.clip(rgb * 255, 0, 255).astype(np.uint8), 'RGB')


# ---- packing ---------------------------------------------------------------------------

def light_color(im):
    """Mean colour of the brightest 8 %: the colour the sign throws on its surroundings."""
    a = np.asarray(im.convert('RGB').resize((96, 96)), dtype=np.float32) / 255.0
    lum = a.max(axis=2)
    sel = a[lum >= np.quantile(lum, 0.92)]
    c = sel.mean(axis=0)
    h, s, v = colorsys.rgb_to_hsv(*(float(x) for x in c))
    return [round(float(x), 3) for x in c], round(h * 360), round(s, 2)


def extrude(atlas, x, y, w, h, g):
    """Copy the image's border pixels into its gap so mips never bleed in black from outside."""
    a = atlas
    a[y:y + h, max(0, x - g):x] = a[y:y + h, x:x + 1]
    a[y:y + h, x + w:x + w + g] = a[y:y + h, x + w - 1:x + w]
    a[max(0, y - g):y, max(0, x - g):x + w + g] = a[y:y + 1, max(0, x - g):x + w + g]
    a[y + h:y + h + g, max(0, x - g):x + w + g] = a[y + h - 1:y + h, max(0, x - g):x + w + g]


def shelf_pack(entries):
    """Shelf-pack scaled images, tallest first, into atlases of ATLAS px. Returns atlases."""
    order = sorted(range(len(entries)), key=lambda i: -entries[i]['img'].height)
    atlases, shelves = [], []
    for i in order:
        im = entries[i]['img']
        w, h = im.width + 2 * GAP, im.height + 2 * GAP
        placed = False
        for ai, a in enumerate(atlases):
            sh = shelves[ai]
            for s in sh:   # [y, height, x_next]
                if h <= s[1] and s[2] + w <= ATLAS:
                    entries[i]['at'] = (ai, s[2] + GAP, s[0] + GAP)
                    s[2] += w
                    placed = True
                    break
            if placed:
                break
            top = sh[-1][0] + sh[-1][1] if sh else 0
            if top + h <= ATLAS:
                sh.append([top, h, w])
                entries[i]['at'] = (ai, GAP, top + GAP)
                placed = True
                break
        if not placed:
            if len(atlases) == MAX_ATLASES:
                raise SystemExit(f'signs: more than {MAX_ATLASES} atlases of {ATLAS} px; lower SCALE')
            atlases.append(None)
            shelves.append([[0, h, w]])
            entries[i]['at'] = (len(atlases) - 1, GAP, GAP)
    return len(atlases)


def pack():
    d = load()
    OUT.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    brands = {b['id']: b for b in d['brands']}
    entries = []

    def add(ident, owner, fmt, im, gain, holo=False, **meta):
        s = SCALE[fmt] / max(im.width, im.height)
        if s < 1:
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        color, hue, sat = light_color(im)
        entries.append(dict(id=ident, owner=owner, format=fmt, img=im.convert('RGB'),
                            aspect=round(im.width / im.height, 4), holo=holo, gain=gain,
                            color=color, hue=hue, sat=sat, **meta))

    missing = []
    for it in items(d):
        src = SRC / f"{it['id']}.webp"
        if not src.exists():
            missing.append(it['id'])
            continue
        im = Image.open(src).convert('RGB')
        if it['kind'] == 'business':
            b = next(x for x in d['businesses'] if x['id'] == it['owner'])
            add(it['id'], it['owner'], it['format'], im, GAIN[it['style']], floor=b['floor'], script=b['script'], **({'tall': True} if b.get('tall') else {}))
        else:
            br = brands[it['owner']]
            if it['format'] == 'land':
                # Rooftop board (~2.4:1) and the tower billboard (~1.6:1) from the same photo.
                add(f"{br['id']}.board", br['id'], 'board', compose_board(br, im, 1536, 640, 'side'), GAIN['brand'], brand=True, jp=bool(br.get('jp')))
                add(f"{br['id']}.wide", br['id'], 'wide', compose_board(br, im, 1280, 800, 'side'), GAIN['brand'], brand=True, jp=bool(br.get('jp')))
            else:
                add(f"{br['id']}.tall", br['id'], 'tall', compose_board(br, im, 512, 1536, 'foot'), GAIN['brand'], brand=True, jp=bool(br.get('jp')))
    for br in d['brands']:
        if not br.get('jp'):
            add(f"{br['id']}.mark", br['id'], 'mark', compose_mark(br), GAIN['mark'], holo=True, brand=True)
    if missing:
        print(f'WARNING: {len(missing)} signs not rendered yet (run --render):', ' '.join(missing[:12]), '...' if len(missing) > 12 else '')

    n = shelf_pack(entries)
    arrays = [np.zeros((ATLAS, ATLAS, 4), dtype=np.uint8) for _ in range(n)]
    for a in arrays:
        a[..., 3] = 255
    used_h = [0] * n
    for e in entries:
        ai, x, y = e['at']
        im = np.asarray(e['img'])
        h, w = im.shape[:2]
        arrays[ai][y:y + h, x:x + w, :3] = im
        extrude(arrays[ai], x, y, w, h, GAP)
        used_h[ai] = max(used_h[ai], y + h + GAP)
    sizes = []
    for ai, a in enumerate(arrays):
        # Trim unused rows (to a multiple of 8: block compression, banded KTX2 encoding).
        H = min(ATLAS, (used_h[ai] + 7) // 8 * 8)
        Image.fromarray(a[:H], 'RGBA').save(OUT / f'signs_{ai}.webp', quality=88, method=6, exact=True)
        sizes.append([ATLAS, H])
    for stale in OUT.glob('signs_*.webp'):
        if int(stale.stem.split('_')[1]) >= n:
            stale.unlink()
    catalog = []
    for e in entries:
        ai, x, y = e['at']
        W, H = sizes[ai]
        w, h = e['img'].size
        rec = {k: v for k, v in e.items() if k not in ('img', 'at')}
        rec['atlas'] = ai
        rec['rect'] = [round(x / W, 6), round(1 - (y + h) / H, 6), round(w / W, 6), round(h / H, 6)]
        catalog.append(rec)
    # Screens: the brands' tall campaigns cropped to 2:3, in a uniform grid (facade shader).
    screens = [e for e in entries if e['format'] == 'tall']
    cols = 6
    rows = max(1, (len(screens) + cols - 1) // cols)
    sw, shh = 384, 576
    sc = Image.new('RGBA', (cols * sw, rows * shh), (0, 0, 0, 255))
    for k, e in enumerate(screens):
        im = e['img']
        crop = cover(im.crop((0, 0, im.width, round(im.height * 0.62))), sw, shh)
        sc.paste(crop.convert('RGBA'), ((k % cols) * sw, (k // cols) * shh))
    sc.save(OUT / 'screens.webp', quality=88, method=6, exact=True)
    (OUT / 'catalog.json').write_text(json.dumps({
        'atlases': sizes, 'entries': catalog,
        'screens': {'count': len(screens), 'cols': cols, 'rows': rows},
    }, ensure_ascii=False, indent=1) + '\n')
    for ai in range(n):
        Image.open(OUT / f'signs_{ai}.webp').convert('RGB').resize((1024, sizes[ai][1] // 4)).save(PREVIEW / f'atlas_{ai}.png')
    print(f'{len(catalog)} signs in {n} atlases {sizes}; {len(screens)} screens')
    ktx = json.loads((ROOT / 'art' / 'textures' / 'ktx2.def.json').read_text())
    listed = sorted(t['id'] for t in ktx['textures'] if t['id'].startswith('signs_') and t['id'] != 'signs_screens')
    if listed != [f'signs_{i}' for i in range(n)]:
        raise SystemExit(f'art/textures/ktx2.def.json lists {listed}; make it signs_0..signs_{n - 1}')


def candidates(ids, n, start):
    """Render seeds start..start+n-1 of each sign in `ids` (comma list) and draw them side by
    side in build/previews/signs/candidates.png; pin the pick in the def's `seeds`."""
    d = load()
    want = ids.split(',')
    its = [it for it in items(d) if it['id'] in want]
    PREVIEW.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(str(FONTS / 'NotoSansJP.ttf'), 18)
    cell = (360, 360)
    sheet_im = Image.new('RGB', (n * cell[0], len(its) * cell[1]), (45, 45, 48))
    dr = ImageDraw.Draw(sheet_im)
    for r, it in enumerate(its):
        for c in range(n):
            it2 = dict(it, seed=start + c)
            t = take_path(it2)
            if not t.exists():
                print(f"{it['id']} seed {it2['seed']}", flush=True)
                run_img(it2, t)
            im = crop_sign(Image.open(t).convert('RGB'), it['style'])
            im.thumbnail((cell[0] - 12, cell[1] - 34))
            sheet_im.paste(im, (c * cell[0] + 6, r * cell[1] + 30))
            dr.text((c * cell[0] + 6, r * cell[1] + 4), f"{it['id']} s{it2['seed']}", fill=(230, 230, 230), font=font)
    sheet_im.save(PREVIEW / 'candidates.png')
    print('wrote', PREVIEW / 'candidates.png')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['--candidates']:
        candidates(args[1], int(args[2]), int(args[3]))
    elif args[:1] == ['--render']:
        render(args[1] if len(args) > 1 else '*')
    elif args[:1] == ['--sheet']:
        sheet()
    else:
        pack()
