// Quick look: node next/tests/shot.mjs <view> [<view> ...]  → build/shots/next/<view>.png
// Starts nothing: run `npm run next:dev` first (port 5183).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const views = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const extra = process.argv.find((a) => a.startsWith('--q='))?.slice(4) ?? '';
// --live: let the clock run for a few seconds first (motion, compute passes) instead of freezing it.
const live = process.argv.includes('--live');
mkdirSync('build/shots/next', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 900)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 900)));
for (const view of views.length ? views : ['corner']) {
  await page.goto(`http://localhost:5183/?view=${view}${live || extra.includes('t=') ? '' : '&t=20'}${extra ? `&${extra}` : ''}`);
  await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 90_000 });
  await page.waitForTimeout(live ? 6000 : 800);
  await page.screenshot({ path: `build/shots/next/${view}${live ? '-live' : ''}.png` });
  console.log(view, JSON.stringify(await page.evaluate(() => window.__SLICE)));
}
await browser.close();
