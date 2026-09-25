// Debug: contact sheet of Blender previews for assets matching a glob, one row per asset.
// Usage: node tools/debug/sheet.mjs ['buildings/*'] [out=build/debug/sheet.png] [views=front34,back34]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { P, globToRegex, listDefs } from '../lib/common.mjs';

const glob = process.argv[2] ?? '**';
const out = process.argv[3] ?? path.join(P.build, 'debug', 'sheet.png');
const views = (process.argv[4] ?? 'front34').split(',');
const re = globToRegex(glob);
const ids = listDefs().map((d) => d.id).filter((id) => re.test(id));
const cells = ids.flatMap((id) => views.map((v) => ({ id, v, file: path.join(P.previews, id, `${v}.png`) })))
  .filter((c) => fs.existsSync(c.file));
const cols = Math.min(6, cells.length);
const html = `<body style="margin:0;background:#111;font:12px monospace;color:#ccc">
<div style="display:grid;grid-template-columns:repeat(${cols},256px);gap:2px">
${cells.map((c) => `<div><img width=256 height=256 src="data:image/png;base64,${fs.readFileSync(c.file).toString('base64')}"><div>${c.id} ${c.v}</div></div>`).join('')}
</div></body>`;
fs.mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * 258, height: 800 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out, cells.length, 'previews');
