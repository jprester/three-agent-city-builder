import { describe, expect, it } from 'vitest';
import catalog from '../../art/textures/advertising/catalog.json';
import defs from '../../art/advertising/catalog.def.json';
import layout from '../../public/layouts/city.json';

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
  it('binds generated placements to the new catalogue and reserves shafts for campaigns', () => {
    const shafts = layout.signs.filter(s => s.zone === 'shaft');
    expect(shafts.length).toBeGreaterThan(0);
    for (const s of layout.signs) {
      if (s.art === undefined) continue;
      const e = catalog.entries[s.art];
      expect(e).toBeDefined();
      expect(s.size[0] / s.size[1]).toBeCloseTo(e.aspect, 2);
    }
    for (const s of shafts) expect(catalog.entries[s.art!].surface).toBe('screen');
  });
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
