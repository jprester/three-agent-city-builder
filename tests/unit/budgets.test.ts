import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { checkBudgets, printBudgets } from '../../tools/check-budgets.mjs';
import * as common from '../../tools/lib/common.mjs';

afterEach(() => vi.restoreAllMocks());

it('reports missing base and LOD outputs instead of silently passing an incomplete build', async () => {
  const defs = common.listDefs().filter((entry) => entry.id === 'buildings/slab_a' || entry.id === 'buildings/slab_a.lod1');
  expect(defs).toHaveLength(2);
  vi.spyOn(common, 'listDefs').mockReturnValue(defs);
  const missing = new Set(defs.map((entry) => common.assetOutPath(entry.id)));
  const exists = fs.existsSync;
  vi.spyOn(fs, 'existsSync').mockImplementation((file) => missing.has(String(file)) ? false : exists(file));

  const results = await checkBudgets();
  expect(results.map((result) => result.id)).toEqual(defs.map((entry) => entry.id));
  for (const result of results) {
    expect(result.problems).toEqual(['missing generated GLB; run npm run assets']);
    expect(result.triangles).toBeNull();
  }
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(printBudgets(results)).toBe(2);
  expect(output).toHaveBeenCalledTimes(2);
});
