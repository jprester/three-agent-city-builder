// Small helpers shared by the layout generators. Browser-safe.

export const r3 = (v) => Math.round(v * 1000) / 1000;

export function centroidOf(pts) {
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

export function globToRegex(glob) {
  return new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
}
