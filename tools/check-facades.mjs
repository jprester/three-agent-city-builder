// Facade mapping check: every window and photo-facade face must be mapped so the runtime can
// show whole floors and bays on it (src/materials/facade.ts fWholeFit), and every tower facade
// photo must have a grid of whole floors and bays (tools/textures/facade_grid.py).
//   node tools/check-facades.mjs [filter]      e.g. buildings/tower
// Per GLB, for each triangle whose surface code (COLOR_0.r) is a window kind or the atlas:
//   module   it carries a facade module (_FACE, lib.mesh MeshBuilder `module`) > 0
//   band     it lies inside one module vertically: 0 <= v <= module height
//   meters   its UVs are meter-scale and upright: v grows 1:1 with height on walls, and the UV
//            area equals the world area (no stretched or squashed mapping)
//   cells    (procedural kinds, unlocked modules) the runtime stretches cells to fill the module
//            whole; a stretch over STRETCH_WARN is printed as a warning (a band that should be
//            built in whole cells). Locked modules (geometry on the cells) are left as built.
// Exit code 1 on any error. Warnings print but pass.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'public/assets';
const filter = process.argv[2] ?? '';
const facade = JSON.parse(readFileSync('art/style/facade.json', 'utf8'));
const T = facade.types;
const C = facade.cells;
/** Surface code -> cell (w, h) in meters; null: the atlas (any module, fitted at runtime). */
const KINDS = new Map([
  [T.residential, C.residential], [T.tower_res, C.residential], [T.cage, C.residential],
  [T.office, C.office], [T.curtain, C.curtain], [T.glass, C.curtain], [T.podium, C.podium],
  [T.atlas, null],
]);
const NAME = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));
const EPS = 0.02;          // m
const STRETCH_WARN = 0.2;  // runtime cell stretch (share of a cell) worth reporting

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const errors = [];
const warnings = [];

// --- Tower facade photos: grids of whole floors and bays inside each facade rect.
for (const [bundle, file] of [['baked_osaka', 'art/textures/facades/baked_osaka.json'], ['baked_glass', 'art/textures/facades/baked_glass.json'],
  ['baked_sky', 'art/textures/facades/baked_sky.json'], ['baked', 'art/textures/facades/baked.json']]) {
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  spec.facades.forEach((f, i) => {
    const where = `${file} facade ${i}`;
    if (!f.grid) { errors.push(`${where}: no grid (python3 tools/textures/facade_grid.py)`); return; }
    const [x0, y0, x1, y1] = f.grid, r = f.rect;
    if (!(r[0] <= x0 && x0 < x1 && x1 <= r[2] && r[1] <= y0 && y0 < y1 && y1 <= r[3])) errors.push(`${where}: grid outside its rect`);
    for (const [size, period, what] of [[y1 - y0, f.floor, 'floors'], [x1 - x0, f.bay, 'bays']]) {
      const n = size / period;
      if (Math.abs(n - Math.round(n)) > 1e-3 || Math.round(n) < 1) errors.push(`${where}: grid holds ${n.toFixed(3)} ${what}`);
    }
    if (Math.abs(f.wrap[0] - (x1 - x0)) > 1e-6 || Math.abs(f.wrap[1] - (y1 - y0)) > 1e-6) errors.push(`${where}: wrap is not the grid size`);
  });
}

// --- Generated assets.
const files = readdirSync(ROOT, { recursive: true }).filter((f) => f.endsWith('.glb') && f.includes(filter)).sort();
let checked = 0;
for (const file of files) {
  const doc = await io.read(join(ROOT, file));
  const problems = new Map();   // message -> count, first position
  const note = (msg, p) => {
    const e = problems.get(msg) ?? { n: 0, at: p };
    e.n++;
    problems.set(msg, e);
  };
  const cellNotes = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const xf = (p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), col = prim.getAttribute('COLOR_0');
      const uv = prim.getAttribute('TEXCOORD_0'), face = prim.getAttribute('_FACE');
      if (!col) continue;
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const vi = (k) => (idx ? idx.getScalar(k) : k);
      for (let k = 0; k + 2 < n; k += 3) {
        const ids = [vi(k), vi(k + 1), vi(k + 2)];
        const code = Math.floor(col.getElement(ids[0], [])[0] * 16);
        if (!KINDS.has(code)) continue;
        checked++;
        const P = ids.map((i) => xf(pos.getElement(i, [])));
        const at = P[0].map((c) => +c.toFixed(1));
        const kind = NAME[code];
        if (!uv) { note(`${kind}: no UVs`, at); continue; }
        // glTF stores 1 - v (lib.mesh writes Blender UVs).
        const U = ids.map((i) => { const t = uv.getElement(i, []); return [t[0], 1 - t[1]]; });
        const mod = face ? face.getElement(ids[0], []) : [0, 0, 0];
        const hasModule = mod[0] > EPS && mod[1] > EPS;
        if (!hasModule) note(`${kind}: no facade module (pass module= to MeshBuilder, or build it with walls())`, at);
        // Meter scale: UV area = world area; on walls, v grows 1:1 with height.
        const e1 = sub(P[1], P[0]), e2 = sub(P[2], P[0]);
        const nrm = cross(e1, e2), area = len(nrm) / 2;
        if (area < 1e-4) continue;
        const d1 = [U[1][0] - U[0][0], U[1][1] - U[0][1]], d2 = [U[2][0] - U[0][0], U[2][1] - U[0][1]];
        const uvArea = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / 2;
        if (Math.abs(uvArea / area - 1) > 0.03) note(`${kind}: UVs not meter-scale (UV/world area ${(uvArea / area).toFixed(2)})`, at);
        const unit = nrm.map((c) => c / (2 * area));
        if (Math.abs(unit[1]) < 0.3) {
          // dv per meter straight up along the face: v must rise with height, 1:1.
          const g = gradient(e1, e2, d1[1], d2[1]);
          const up = [0, 1, 0], inPlane = sub(up, unit.map((c) => c * dot(up, unit)));
          const s = dot(g, inPlane) / Math.max(len(inPlane) ** 2, 1e-9);
          if (Math.abs(s - 1) > 0.02) note(`${kind}: v does not run up the wall at 1 m/m (${s.toFixed(2)})`, at);
          // One band: inside [0, module height].
          if (!hasModule) continue;
          const vs = U.map((t) => t[1]);
          if (Math.min(...vs) < -EPS || Math.max(...vs) > mod[1] + EPS) note(`${kind}: face reaches outside its module (v ${Math.min(...vs).toFixed(2)}..${Math.max(...vs).toFixed(2)}, module height ${mod[1].toFixed(2)})`, at);
        }
        const cell = KINDS.get(code);
        if (cell && hasModule && !(mod[2] > 0.5)) {
          for (const [size, c, axis] of [[mod[0], cell.w, 'wide'], [mod[1], cell.h, 'tall']]) {
            const r = size / c, n = Math.max(1, Math.round(r)), stretch = r / n - 1;
            if (Math.abs(stretch) > STRETCH_WARN) cellNotes.set(`${kind}: module ${size.toFixed(2)} m ${axis} is ${r.toFixed(2)} cells of ${c} m: drawn as ${n}, each ${(stretch * 100).toFixed(0)} % ${stretch > 0 ? 'wider/taller' : 'narrower/shorter'}`, at);
          }
        }
      }
    }
  }
  for (const [msg, { n, at }] of problems) errors.push(`${file}: ${msg} — ${n} triangle${n > 1 ? 's' : ''}, e.g. near [${at}]`);
  for (const [msg, at] of cellNotes) warnings.push(`${file}: ${msg}, e.g. near [${at}]`);
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`FAIL  ${e}`);
console.log(`${checked} window/atlas triangles in ${files.length} assets: ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
/** World-space gradient (in the triangle's plane) of a scalar with deltas s1, s2 along e1, e2. */
function gradient(e1, e2, s1, s2) {
  const a = dot(e1, e1), b = dot(e1, e2), c = dot(e2, e2), det = a * c - b * b;
  const x = (s1 * c - s2 * b) / det, y = (s2 * a - s1 * b) / det;
  return [e1[0] * x + e2[0] * y, e1[1] * x + e2[1] * y, e1[2] * x + e2[2] * y];
}
