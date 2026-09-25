// Debug: print a GLB's root extras and per-primitive attribute types and ranges.
// Usage: node tools/debug/attrs.mjs public/assets/<id>.glb
import { getIO } from '../optimize.mjs';
const io = await getIO();
const doc = await io.read(process.argv[2]);
console.log('extras', JSON.stringify(doc.getRoot().getExtras()));
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const out = [];
  for (const sem of prim.listSemantics()) {
    const a = prim.getAttribute(sem); const v = [];
    const n = a.getCount(); const lo = Array(a.getElementSize()).fill(1e9), hi = Array(a.getElementSize()).fill(-1e9);
    for (let i = 0; i < n; i++) { a.getElement(i, v); v.forEach((x, k) => { lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x); }); }
    out.push(`${sem}[${a.getComponentType()}${a.getNormalized() ? 'n' : ''}] ${lo.map((x) => x.toFixed(3)).join(',')} .. ${hi.map((x) => x.toFixed(3)).join(',')}`);
  }
  console.log(prim.getMaterial()?.getName(), '\n  ' + out.join('\n  '));
}
