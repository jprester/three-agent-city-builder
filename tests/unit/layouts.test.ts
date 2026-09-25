import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateLayout } from '../../src/systems/layout';

// Every layout def, run through the same in-browser path that `?seed=` uses.
const defs = Object.keys(import.meta.glob('/art/layouts/defs/*.json')).map((f) => f.replace(/^.*\/(.+)\.json$/, '$1'));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe.each(defs)('layout %s', (id) => {
  it('is deterministic for a given seed', async () => {
    expect(hash(await generateLayout(id, 1234))).toBe(hash(await generateLayout(id, 1234)));
  });

  it('changes with the seed', async () => {
    expect(hash(await generateLayout(id, 1))).not.toBe(hash(await generateLayout(id, 2)));
  });
});

it('finds layout defs', () => {
  expect(defs.length).toBeGreaterThan(0);
});
