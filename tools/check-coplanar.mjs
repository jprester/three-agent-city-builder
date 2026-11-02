// Finds z-fighting in generated assets: pairs of triangles in the same plane, facing the
// same way, whose areas overlap. Such pairs flicker as the camera moves (whichever wins the
// depth test changes from pixel to pixel and frame to frame).
//   node tools/check-coplanar.mjs [glob-ish filter]   e.g. buildings/midrise
//   VERBOSE=1 also prints the largest overlapping triangle pairs (bounding boxes, glTF Y-up).
// Prints every asset over MIN_AREA with the overlap area and where it is. Exit code 1 if
// any asset overlaps by more than FAIL_AREA (small corner overlaps of parapet tops and
// LED strips remain and are not visible; broad bands like a parapet flush with a wall are).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'public/assets';
const MIN_AREA = 0.05;          // m² of overlap worth reporting
const FAIL_AREA = 30;           // m² in one asset that fails the check
const PLANE_EPS = 0.004;        // m: planes closer than this count as the same
const filter = process.argv[2] ?? '';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const files = readdirSync(ROOT, { recursive: true }).filter((f) => f.endsWith('.glb') && f.includes(filter)).sort();
const results = [];
for (const file of files) {
  const doc = await io.read(join(ROOT, file));
  const tris = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const xf = (p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const at = (k) => xf(pos.getElement(idx ? idx.getScalar(k) : k, []));
      for (let k = 0; k + 2 < n; k += 3) tris.push([at(k), at(k + 1), at(k + 2)]);
    }
  }
  // Bucket by plane (unit normal, offset).
  const buckets = new Map();
  for (const t of tris) {
    const u = sub(t[1], t[0]), v = sub(t[2], t[0]);
    let nrm = cross(u, v);
    const a2 = len(nrm);
    if (a2 < 1e-6) continue;
    nrm = nrm.map((c) => c / a2);
    const d = dot(nrm, t[0]);
    const key = `${nrm.map((c) => Math.round(c * 50)).join(',')}|${Math.round(d / PLANE_EPS)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ t, nrm });
  }
  let area = 0, where = null;
  const pairs = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const ax = list[0].nrm.map(Math.abs);
    const drop = ax[0] > ax[1] && ax[0] > ax[2] ? 0 : ax[1] > ax[2] ? 1 : 2;
    const to2 = (p) => [p[(drop + 1) % 3], p[(drop + 2) % 3]];
    const flat = list.map((e) => e.t.map(to2));
    for (let i = 0; i < flat.length; i++) {
      for (let j = i + 1; j < flat.length; j++) {
        const o = overlap(flat[i], flat[j]);
        if (o > 1e-4 && process.env.VERBOSE) pairs.push({ o, a: bbox(list[i].t), b: bbox(list[j].t), n: list[i].nrm.map((c) => +c.toFixed(2)) });
        if (o > 1e-4) { area += o; if (!where || o > where.o) where = { o, at: list[i].t[0].map((c) => +c.toFixed(2)), n: list[i].nrm.map((c) => +c.toFixed(2)) }; }
      }
    }
  }
  if (process.env.VERBOSE && area > MIN_AREA) for (const p of pairs.sort((x, y) => y.o - x.o).slice(0, 6)) console.log(`  ${file} ${p.o.toFixed(2)} m² n=${JSON.stringify(p.n)} A=${JSON.stringify(p.a)} B=${JSON.stringify(p.b)}`);
  if (area > MIN_AREA) results.push({ file, area: +area.toFixed(2), at: where.at, n: where.n });
}
results.sort((a, b) => b.area - a.area);
for (const r of results) console.log(`${r.file.padEnd(40)} ${String(r.area).padStart(8)} m² overlapping, e.g. near ${JSON.stringify(r.at)} facing ${JSON.stringify(r.n)}`);
const failing = results.filter((r) => r.area > FAIL_AREA);
console.log(`${results.length} of ${files.length} assets have coplanar overlaps over ${MIN_AREA} m²; ${failing.length} over ${FAIL_AREA} m²`);
process.exit(failing.length ? 1 : 0);

function bbox(t) { return [0, 1, 2].map((k) => [Math.min(...t.map((p) => p[k])), Math.max(...t.map((p) => p[k]))].map((c) => +c.toFixed(2))); }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }

/** Area of the intersection of two 2D triangles (Sutherland–Hodgman clip). */
function overlap(a, b) {
  const orient = (t) => ((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]) < 0 ? [t[0], t[2], t[1]] : t);
  let poly = orient(a);
  const clipT = orient(b);
  for (let e = 0; e < 3 && poly.length; e++) {
    const p = clipT[e], q = clipT[(e + 1) % 3];
    const side = (s) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const c = poly[k], n = poly[(k + 1) % poly.length], sc = side(c), sn = side(n);
      if (sc >= 0) out.push(c);
      if ((sc >= 0) !== (sn >= 0)) { const t = sc / (sc - sn); out.push([c[0] + (n[0] - c[0]) * t, c[1] + (n[1] - c[1]) * t]); }
    }
    poly = out;
  }
  let s = 0;
  for (let k = 0; k < poly.length; k++) { const c = poly[k], n = poly[(k + 1) % poly.length]; s += c[0] * n[1] - n[0] * c[1]; }
  return Math.abs(s) / 2;
}
