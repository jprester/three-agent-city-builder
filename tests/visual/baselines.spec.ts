import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Viewpoint } from '../../src/debug/viewpoints';

const viewpoints: Viewpoint[] = JSON.parse(readFileSync('src/debug/viewpoints.json', 'utf8'));
const layout = process.env.LAYOUT ?? 'city';

// This project depends on chromium, which writes fresh captures and verifies render health.
// Compare those PNGs without loading the heavy scene a second time. Only the human's
// explicit shots:approve command may create or update the reference images.
for (const vp of viewpoints) {
  test(`${layout} @ ${vp.name}`, () => {
    const capture = readFileSync(`build/shots/${layout}/${vp.name}.png`);
    expect(capture).toMatchSnapshot([layout, `${vp.name}.png`], { maxDiffPixelRatio: 0.02 });
  });
}
