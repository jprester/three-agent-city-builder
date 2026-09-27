import { describe, expect, it } from 'vitest';
import catalog from '../../art/textures/advertising/catalog.json';
import defs from '../../art/advertising/catalog.def.json';

// Typeset builder (tools/textures/build_advertising.py, `npm run signs:typeset`): kept as a
// secondary library for editable copy; not the runtime sign catalogue.
describe('advertising build contract', () => {
  it('has unique, addressable designs and all three campaign layouts', () => {
    const ids = catalog.entries.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of defs.campaigns) for (const shape of ['portrait', 'wide', 'tall']) expect(ids).toContain(`${c.id}-${shape}`);
    for (const s of defs.signs) expect(ids).toContain(s.id);
  });
  it('keeps artwork aspect and padded rectangles inside non-overlapping atlas cells', () => {
    for (const e of catalog.entries) {
      const [w,h] = catalog.sizes[e.atlas as keyof typeof catalog.sizes];
      const [x,y,iw,ih] = e.pixels;
      expect(e.aspect).toBeCloseTo(iw/ih,6);
      expect(e.rect[0]*w).toBeCloseTo(x,5);
      expect((1-e.rect[1]-e.rect[3])*h).toBeCloseTo(y,5);
      expect(x).toBeGreaterThanOrEqual(catalog.padding);
      expect(y).toBeGreaterThanOrEqual(catalog.padding);
      expect(x+iw+catalog.padding).toBeLessThanOrEqual(w);
      expect(y+ih+catalog.padding).toBeLessThanOrEqual(h);
      expect(Math.max(w,h)).toBeLessThanOrEqual(defs.maxAtlasSize);
      for (const other of catalog.entries) {
        if (e.id === other.id || e.atlas !== other.atlas) continue;
        const [ox,oy,ow,oh] = other.pixels;
        const gap=catalog.padding*2;
        expect(x+iw+gap<=ox || ox+ow+gap<=x || y+ih+gap<=oy || oy+oh+gap<=y).toBe(true);
      }
    }
  });
  // Layout binding moved to city.test.ts ('sizes every sign to its artwork aspect'): the
  // runtime catalogue is tools/textures/import_ads.py; this file tests the typeset builder.
  it('keeps physical signs opaque and their exposure explicit', () => {
    for (const e of catalog.entries) {
      expect(e.holo).toBe(false);
      expect(e.gain).toBeGreaterThan(0);
      expect(e.gain).toBeLessThanOrEqual(3);
      expect(['neon','lightbox','screen']).toContain(e.surface);
    }
    expect(catalog.screens.count).toBe(defs.campaigns.length);
  });
});

describe('runtime sign catalog (tools/textures/import_ads.py)', () => {
  it('has unique ids and aspect-exact rects', async () => {
    const cat = (await import('../../art/external/textures/signs/catalog.json')).default;
    const ids = cat.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of cat.entries) {
      const [W, H] = cat.sizes[e.atlas as keyof typeof cat.sizes];
      expect((e.rect[2] * W) / (e.rect[3] * H) / e.aspect).toBeCloseTo(1, 1);
    }
  });
});
