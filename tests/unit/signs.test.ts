import { describe, expect, it } from 'vitest';
import catalog from '../../art/textures/signs/catalog.json';
import def from '../../art/signs/signs.def.json';

// The sign library (tools/textures/build_signs.py from art/signs/signs.def.json).
describe('sign catalog', () => {
  it('has unique ids and aspect-exact rects inside non-overlapping atlas areas', () => {
    const ids = catalog.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(catalog.atlases.length).toBeLessThanOrEqual(4);
    const px = catalog.entries.map((e) => {
      const [W, H] = catalog.atlases[e.atlas];
      const [u, v, du, dv] = e.rect;
      expect(u >= 0 && v >= 0 && u + du <= 1 + 1e-6 && v + dv <= 1 + 1e-6).toBe(true);
      expect((du * W) / (dv * H) / e.aspect).toBeCloseTo(1, 1);
      return { a: e.atlas, x: u * W, y: v * H, w: du * W, h: dv * H };
    });
    for (let i = 0; i < px.length; i++) for (let j = i + 1; j < px.length; j++) {
      const [a, b] = [px[i], px[j]];
      if (a.a !== b.a) continue;
      expect(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5).toBe(true);
    }
  });

  it('gives every business and brand its whole sign set', () => {
    const has = (owner: string, f: string) => catalog.entries.some((e) => e.owner === owner && e.format === f);
    for (const b of def.businesses) {
      const want = (b as { only?: string[] }).only ?? (b.script === 'zh' ? ['overhang', 'hkblade']
        : b.floor === 1 ? ['fascia', 'blade'] : ['panel', 'blade', ...((b as { billboard?: string }).billboard ? ['billboard'] : [])]);
      for (const f of want) expect(has(b.id, f), `${b.id}.${f}`).toBe(true);
    }
    for (const b of def.brands) {
      for (const f of ['board', 'wide', 'tall']) expect(has(b.id, f), `${b.id}.${f}`).toBe(true);
      if (!(b as { jp?: boolean }).jp) expect(has(b.id, 'mark')).toBe(true);
    }
    // Only crown lettering is drawn without a board.
    expect(catalog.entries.filter((e) => e.holo).every((e) => e.format === 'mark')).toBe(true);
    expect(catalog.screens.count).toBe(def.brands.length);
  });
});
