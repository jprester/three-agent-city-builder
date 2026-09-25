// Debug: top-down plan of a built layout as PNG (roads, blocks by district, buildings
// shaded by height, lamps, hero street, flythrough). Usage:
//   node tools/debug/plan.mjs [layout=city] [out=build/debug/<layout>-plan.png]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { P, readJson } from '../lib/common.mjs';

const name = process.argv[2] ?? 'city';
const out = process.argv[3] ?? path.join(P.build, 'debug', `${name}-plan.png`);
const L = readJson(path.join(P.layoutsOut, `${name}.json`));
const [W, D] = L.size;
const pad = 160, S = 1400 / (Math.max(W, D) + 2 * pad);
const X = (x) => ((x + W / 2 + pad) * S).toFixed(1);
const Z = (z) => ((z + D / 2 + pad) * S).toFixed(1);
const poly = (pts) => pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ');
const fill = { core: '#3a3330', towers: '#28303a', industrial: '#33362c' };
const maxH = Math.max(...L.instances.map((i) => i.h));
const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${((W + 2 * pad) * S).toFixed(0)}" height="${((D + 2 * pad) * S).toFixed(0)}" style="background:#0e0f12">`];
for (const b of L.blocks) svg.push(`<polygon points="${poly(b.points)}" fill="${fill[b.district]}"/>`);
for (const r of L.roads) {
  const c = r.cls === 'hero' ? '#ff9a3c' : r.cls === 'arterial' ? '#555' : r.cls === 'secondary' ? '#444' : '#333';
  svg.push(`<line x1="${X(r.a[0])}" y1="${Z(r.a[1])}" x2="${X(r.b[0])}" y2="${Z(r.b[1])}" stroke="${c}" stroke-width="${r.cls === 'hero' ? 2 : 0.6}" stroke-dasharray="${r.cls === 'hero' ? '' : '4 4'}"/>`);
}
for (const i of L.instances) {
  const t = i.rotationY, [hu, hv] = i.fp, c = [i.position[0], i.position[2]];
  const u = [Math.cos(t), -Math.sin(t)], v = [Math.sin(t), Math.cos(t)];
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c[0] + u[0] * hu * a + v[0] * hv * b, c[1] + u[1] * hu * a + v[1] * hv * b]);
  const g = Math.round(70 + 185 * Math.sqrt(i.h / maxH));
  svg.push(`<polygon points="${poly(pts)}" fill="rgb(${g},${g},${g})" stroke="#000" stroke-width="0.4"/>`);
  svg.push(`<line x1="${X(c[0])}" y1="${Z(c[1])}" x2="${X(c[0] + v[0] * hv)}" y2="${Z(c[1] + v[1] * hv)}" stroke="#c33" stroke-width="0.6"/>`);
}
for (const [x, z] of L.lamps) svg.push(`<circle cx="${X(x)}" cy="${Z(z)}" r="1.2" fill="#ffb347"/>`);
if (L.flythrough) {
  const p = L.flythrough.points;
  svg.push(`<polyline points="${p.map(([x, , z]) => `${X(x)},${Z(z)}`).join(' ')} ${X(p[0][0])},${Z(p[0][2])}" fill="none" stroke="#3de0e8" stroke-width="1.2"/>`);
  p.forEach(([x, y, z], k) => svg.push(`<text x="${X(x)}" y="${Z(z)}" fill="#3de0e8" font-size="11" font-family="monospace">${k}:${Math.round(y)}</text>`));
}
svg.push(`<text x="8" y="16" fill="#aaa" font-size="13" font-family="monospace">${name}: ${L.instances.length} buildings, ${L.roads.length} roads, ${L.blocks.length} blocks, ${L.lamps.length} lamps, tallest ${maxH.toFixed(0)} m. Red tick = front.</text>`);
svg.push('</svg>');

fs.mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(svg.join('\n'));
await page.locator('svg').screenshot({ path: out });
await browser.close();
console.log(out);
