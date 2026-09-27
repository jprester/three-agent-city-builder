"""Compose authored signs/campaigns and pack padded color+emission atlases.
RGB is printed color; alpha is emission intensity, NOT transparency. Generated artwork
is an immutable source. Pillow also powers the existing texture import pipeline.
"""
import colorsys
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'art/advertising'
OUT = ROOT / 'art/textures/advertising'
PREVIEW = ROOT / 'build/previews/advertising'
PALETTE = json.loads((ROOT / 'art/style/palette.json').read_text())
FONTS = ROOT / 'art/external/fonts'


def color(name):
    h = PALETTE[name].lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def font(size, jp=False):
    f = ImageFont.truetype(str(FONTS / ('NotoSansJP.ttf' if jp else 'BarlowCondensed-SemiBold.ttf')), max(8, int(size)))
    if jp:
        f.set_variation_by_axes([600])
    return f


def text(draw, value, box, fill, jp=False, max_size=150):
    x, y, w, h = box
    size = min(max_size, h)
    while size > 8:
        f = font(size, jp)
        b = draw.textbbox((0, 0), value, font=f)
        if b[2]-b[0] <= w and b[3]-b[1] <= h:
            break
        size -= 2
    draw.text((x+(w-b[2]+b[0])/2-b[0], y+(h-b[3]+b[1])/2-b[1]), value, font=f, fill=fill)


def icon(draw, name, box, fill, width=6):
    x, y, s = box
    def line(points): draw.line([(x+a*s,y+b*s) for a,b in points], fill=fill, width=width, joint='curve')
    def ellipse(b): draw.ellipse((x+b[0]*s,y+b[1]*s,x+b[2]*s,y+b[3]*s), outline=fill,width=width)
    if name in ('cup', 'bowl', 'steam'):
        for a in (.3,.5,.7): line([(a,.35),(a-.04,.24),(a+.04,.13),(a,.03)])
        if name == 'steam': ellipse((.08,.45,.92,.9))
        else: line([(.12,.48),(.25,.82),(.75,.82),(.88,.48),(.12,.48)])
        line([(.2,.94),(.8,.94)])
        if name == 'cup': ellipse((.76,.5,1,.76))
    elif name == 'cross':
        line([(.4,.08),(.6,.08),(.6,.4),(.92,.4),(.92,.6),(.6,.6),(.6,.92),(.4,.92),(.4,.6),(.08,.6),(.08,.4),(.4,.4),(.4,.08)])
    elif name == 'key':
        ellipse((.12,.08,.66,.62));line([(.52,.52),(.9,.9),(.98,.82),(.88,.72),(.8,.8)])
    elif name == 'game':
        line([(.2,.3),(.8,.3),(.96,.8),(.76,.84),(.64,.64),(.36,.64),(.24,.84),(.04,.8),(.2,.3)])
        line([(.2,.47),(.4,.47)]);line([(.3,.37),(.3,.57)]);ellipse((.67,.43,.74,.5));ellipse((.78,.52,.85,.59))
    elif name == 'laundry':
        line([(.12,.08),(.88,.08),(.88,.94),(.12,.94),(.12,.08)])
        line([(.12,.26),(.88,.26)]);ellipse((.28,.36,.72,.8));ellipse((.68,.13,.74,.19))
    elif name == 'clock':
        ellipse((.08,.08,.92,.92));line([(.5,.2),(.5,.5),(.72,.6)])
    elif name == 'arrow': line([(.1,.5),(.9,.5),(.6,.2)]);line([(.9,.5),(.6,.8)])
    else:
        for i,h in enumerate([.3,.6,.9,.5,.7]): line([(.15+i*.17,.5-h/2),(.15+i*.17,.5+h/2)])


def sign(entry):
    vertical = entry['orientation'] == 'vertical'
    w,h = (288,960) if vertical else (960,288)
    lightbox = entry['surface'] == 'lightbox'
    bg = color('tungsten') if lightbox else color('metal_dark')
    ink = color('metal_dark') if lightbox else color(entry['color'])
    im = Image.new('RGB',(w,h),bg); mask = Image.new('L',(w,h),160 if lightbox else 0)
    d=ImageDraw.Draw(im); m=ImageDraw.Draw(mask)
    for draw,fill in [(d,ink),(m,25 if lightbox else 255)]:
        draw.rounded_rectangle((12,12,w-13,h-13),radius=10,outline=fill,width=4)
        if vertical:
            count=len(entry['jp']); step=min(125,540/count)
            for i,c in enumerate(entry['jp']):
                if c == 'ー':  # Japanese long-vowel mark rotates in vertical typesetting.
                    draw.line((w/2,92+i*step,w/2,72+(i+1)*step-24),fill=fill,width=9)
                else: text(draw,c,(35,72+i*step,w-70,step-8),fill,True,112)
            icon(draw,entry['icon'],(w/2-62,650,124),fill,5)
            text(draw,entry['text'],(25,825,w-50,55),fill,max_size=43)
            draw.line((55,910,w-55,910),fill=fill,width=3)
        else:
            icon(draw,entry['icon'],(32,73,120),fill,6)
            text(draw,entry['text'],(185,40,w-220,113),fill,max_size=103)
            text(draw,entry['jp'],(185,184,w-220,65),fill,True,56)
            draw.line((185,170,w-35,170),fill=fill,width=2)
    # Deterministic surface wear lives in color only, never randomly removes lettering.
    d=ImageDraw.Draw(im)
    for i in range(48):
        x=(i*131+17)%w;y=(i*83+29)%h
        if x<22 or x>w-23 or y<22 or y>h-23: d.line((x,y,min(w-1,x+7),y+1),fill=color('paint'),width=1)
    im.putalpha(mask)
    return im


def campaign(entry, shape):
    w,h={'portrait':(512,768),'wide':(768,512),'tall':(384,1152)}[shape]
    art=Image.open(SOURCE/entry['artwork']).convert('RGB')
    im=Image.new('RGB',(w,h),color('sky'))
    # Reflow: keep the complete image. Never stretch a portrait across another aspect.
    if shape=='portrait': im.paste(art.resize((w,h),Image.Resampling.LANCZOS),(0,0))
    elif shape=='tall': im.paste(art.resize((w,576),Image.Resampling.LANCZOS),(0,355))
    else: im.paste(art.resize((341,512),Image.Resampling.LANCZOS),(427,0))
    d=ImageDraw.Draw(im); accent=color(entry['color']); white=color('fluorescent')
    if shape=='wide':
        text(d,entry['category'],(30,45,357,40),accent,max_size=32)
        words=entry['brand'].split()
        for i,v in enumerate(words): text(d,v,(28,115+i*80,365,76),white,max_size=84)
        # Short readable secondary copy; two lines are kept clear of the artwork.
        text(d,'AFTER HOURS / CITY EDITION',(28,345,365,35),accent,max_size=26)
        text(d,'DISCOVER '+entry['brand'],(28,400,365,42),white,max_size=35)
        d.line((42,470,380,470),fill=accent,width=4)
    else:
        text(d,entry['category'],(24,28,w-48,35),accent,max_size=30)
        words=entry['brand'].split() if shape=='tall' else [entry['brand']]
        for i,v in enumerate(words):text(d,v,(24,86+i*86,w-48,85),white,max_size=96)
        if shape=='tall':
            text(d,'CITY / SERIES 01',(24,280,w-48,36),accent,max_size=28)
            text(d,entry['category'],(24,974,w-48,60),white,max_size=56)
            text(d,'AVAILABLE AFTER DARK',(20,1070,w-40,32),accent,max_size=27)
        else:
            # A dark footer is composited separately, leaving the image untouched as a source.
            d.rectangle((0,h-88,w,h),fill=color('sky'))
            text(d,entry['tagline'],(24,h-70,w-48,40),white,max_size=31)
            d.line((24,h-12,w-24,h-12),fill=accent,width=4)
    im.putalpha(Image.new('L',(w,h),220))
    return im


def pack(items, name, padding, limit):
    # Fixed-height shelves with per-image rects; edges extruded into generous mip gutters.
    sw=max(im.width for _,im,_ in items)+2*padding
    sh=max(im.height for _,im,_ in items)+2*padding
    cols=min(max(1,math.ceil(math.sqrt(len(items)*sh/sw))),limit//sw)
    rows=math.ceil(len(items)/cols);W,H=cols*sw,rows*sh
    if max(W,H)>limit: raise ValueError(f'{name}: atlas exceeds {limit}px; split the library')
    atlas=Image.new('RGBA',(W,H));entries=[]
    for i,(id,im,meta) in enumerate(items):
        x=i%cols*sw+padding;y=i//cols*sh+padding
        # Stretch only the border pixels into gutters, not the artwork.
        atlas.paste(im,(x,y))
        for k in range(1,padding+1):
            atlas.paste(im.crop((0,0,1,im.height)),(x-k,y))
            atlas.paste(im.crop((im.width-1,0,im.width,im.height)),(x+im.width-1+k,y))
        row=atlas.crop((x-padding,y,x+im.width+padding,y+1));bottom=atlas.crop((x-padding,y+im.height-1,x+im.width+padding,y+im.height))
        for k in range(1,padding+1):atlas.paste(row,(x-padding,y-k));atlas.paste(bottom,(x-padding,y+im.height-1+k))
        c=color(meta['color']);hue,sat,_=colorsys.rgb_to_hsv(*(v/255 for v in c))
        entries.append(dict(id=id,atlas=name,rect=[x/W,1-(y+im.height)/H,im.width/W,im.height/H],pixels=[x,y,im.width,im.height],aspect=im.width/im.height,holo=False,kind=meta['kind'],surface=meta['surface'],gain=meta['gain'],color=[round(v/255,4) for v in c],hue=round(hue*360),sat=round(sat,3)))
    atlas.save(OUT/(name+'.webp'),lossless=True,method=6,exact=True)
    return entries,[W,H]


def main():
    config=json.loads((SOURCE/'catalog.def.json').read_text())
    OUT.mkdir(parents=True,exist_ok=True);PREVIEW.mkdir(parents=True,exist_ok=True)
    buckets={k:[] for k in ['neon_v','neon_h','posters_p','posters_l']};review=[];screens=[]
    for e in config['signs']:
        im=sign(e);meta=dict(e,kind='neon',gain=2.7 if e['surface']=='neon' else 0.9)
        buckets['neon_v' if e['orientation']=='vertical' else 'neon_h'].append((e['id'],im,meta));review.append((e['id'],im))
    for e in config['campaigns']:
        for shape,bucket in [('portrait','posters_p'),('wide','posters_l'),('tall','neon_v')]:
            im=campaign(e,shape);buckets[bucket].append((e['id']+'-'+shape,im,dict(e,kind='ad',surface='screen',gain=1.15)));review.append((e['id']+'-'+shape,im))
            if shape=='portrait':screens.append(im)
    entries=[];sizes={}
    for name,items in buckets.items():
        es,size=pack(items,name,config['padding'],config['maxAtlasSize']);entries+=es;sizes[name]=size
    screen_cols=math.ceil(math.sqrt(len(screens)));screen_rows=math.ceil(len(screens)/screen_cols)
    screen=Image.new('RGB',(512*screen_cols,768*screen_rows))
    for i,im in enumerate(screens):screen.paste(im.convert('RGB'),(i%screen_cols*512,i//screen_cols*768))
    screen.save(OUT/'screens.webp',quality=94,method=6)
    digest=hashlib.sha256()
    for p in sorted([SOURCE/'catalog.def.json',ROOT/'art/style/palette.json',Path(__file__),*list((SOURCE/'artwork').glob('*.png')),*list(FONTS.glob('*.ttf'))]):digest.update(p.read_bytes())
    (OUT/'catalog.json').write_text(json.dumps(dict(version=1,sourceHash=digest.hexdigest(),entries=entries,sizes=sizes,padding=config['padding'],screens=dict(count=len(screens),cols=screen_cols,rows=screen_rows)),indent=2)+'\n')
    sheet=Image.new('RGB',(6*250,math.ceil(len(review)/6)*405),color('sky'));d=ImageDraw.Draw(sheet)
    for i,(id,im) in enumerate(review):
        im.convert('RGB').save(PREVIEW/(id+'.png'));thumb=im.convert('RGB');thumb.thumbnail((234,365));x=i%6*250;y=i//6*405;sheet.paste(thumb,(x+(250-thumb.width)//2,y+25));d.text((x+8,y+5),id,fill=color('fluorescent'))
    sheet.save(PREVIEW/'contact-sheet.jpg',quality=92)
    print(f'Advertising: {len(config["signs"])} signs, {len(config["campaigns"])} campaigns, {len(entries)} packed variants.')


if __name__=='__main__':main()
