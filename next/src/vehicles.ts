import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PaletteName } from './tsl';

/**
 * Road vehicle bodies from one part scheme. Each body is a few side profiles extruded across
 * the car (lower body, glasshouse), so the windscreen and rear window slope, plus parts:
 * pillars, roof skin, wheel arches, wheels with hubs, mirrors, bumpers, grille, number
 * plates and lamps. Forward is +x, the ground y = 0, the car centred on x = 0.
 * Every vertex carries `part`; the car material shades by it:
 */
export const PART = { paint: 0, glass: 1, head: 2, tail: 3, tyre: 4, trim: 5, roofLight: 6, plate: 7, hub: 8, vacancy: 9, stripe: 10 } as const;

export interface BodyType {
  name: string;
  /** Share of the traffic (weights, normalised over the types). */
  weight: number;
  /** Paints this type is sold in, picked per car from its seed. */
  paints: PaletteName[];
  build(b: BodyBuilder): void;
}

type Pt = [number, number];

/** Collects parts into one geometry with a `part` attribute. */
export class BodyBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];

  private push(g: THREE.BufferGeometry, part: number) {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('uv');
    geo.setAttribute('part', new THREE.Float32BufferAttribute(new Array(geo.getAttribute('position').count).fill(part), 1));
    this.parts.push(geo);
  }

  box(sx: number, sy: number, sz: number, x: number, y: number, z: number, part: number) {
    this.push(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), part);
  }

  /** A box from p0 to p1 in the side (x, y) plane at depth z: a pillar or a raked edge. */
  bar(p0: Pt, p1: Pt, z: number, thick: number, depth: number, part: number) {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const g = new THREE.BoxGeometry(len, thick, depth).rotateZ(Math.atan2(p1[1] - p0[1], p1[0] - p0[0]));
    this.push(g.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, z), part);
  }

  /** A convex side profile (counter-clockwise in x, y) extruded from z0 to z1, flat-shaded. */
  prism(profile: Pt[], z0: number, z1: number, part: number) {
    const pos: number[] = [], nrm: number[] = [];
    const tri = (a: number[], b: number[], c: number[], n: number[]) => { pos.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) nrm.push(...n); };
    for (let i = 1; i < profile.length - 1; i++) {
      const [a, b, c] = [profile[0], profile[i], profile[i + 1]];
      tri([a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1], [0, 0, 1]);
      tri([a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0], [0, 0, -1]);
    }
    for (let i = 0; i < profile.length; i++) {
      const p = profile[i], q = profile[(i + 1) % profile.length];
      const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
      const n = [dy / l, -dx / l, 0];
      tri([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], n);
      tri([p[0], p[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], n);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    this.push(g, part);
  }

  /** Wheel at x with radius r, its outer face at |z| = side: tyre (a hexagon), hub, and the dark arch behind it. */
  wheel(x: number, r: number, side: number, archTop: number) {
    const hex: Pt[] = Array.from({ length: 6 }, (_, k) => {
      const a = (k + 0.5) * Math.PI / 3;
      return [x + Math.cos(a) * r, r + Math.sin(a) * r];
    });
    // One tyre prism and one hub plate across the axle: the parts between are inside the body.
    this.prism(hex, -side, side, PART.tyre);
    this.box(r * 0.9, r * 0.9, side * 2 + 0.012, x, r, 0, PART.hub);
    this.box(r * 2.7, archTop - 0.25, side * 2 - 0.02, x, (archTop + 0.25) / 2, 0, PART.trim);
  }

  /** Mirrors, bumpers, grille, plates and lamps: the parts every body shares. */
  ends(o: { front: number; rear: number; width: number; bumperY: number; head: [number, number, number, number]; tail: [number, number, number, number]; mirrorX: number; mirrorY: number }) {
    const w = o.width;
    // Mirrors as one bar across the car: the middle is inside the glasshouse.
    this.box(0.1, 0.09, w + 0.3, o.mirrorX, o.mirrorY, 0, PART.paint);
    for (const s of [-1, 1]) {
      const [hy, hh, hw, hz] = o.head, [ty, th, tw, tz] = o.tail;
      this.box(0.04, hh, hw, o.front + 0.005, hy, s * hz, PART.head);
      this.box(0.04, th, tw, o.rear - 0.005, ty, s * tz, PART.tail);
    }
    for (const x of [o.front, o.rear]) {
      this.box(0.09, 0.13, w - 0.04, x, o.bumperY, 0, PART.trim);
      this.box(0.02, 0.11, 0.33, x + Math.sign(x) * 0.055, o.bumperY + 0.12, 0, PART.plate);
    }
    this.box(0.03, 0.1, w * 0.36, o.front - 0.005, o.head[0] - 0.02, 0, PART.trim);
  }

  build(): THREE.BufferGeometry {
    return mergeGeometries(this.parts, false);
  }
}

/** A sedan's body: shared by the sedan and the taxi. */
function sedan(b: BodyBuilder) {
  const W = 1.74;
  b.prism([[-2.25, 0.28], [2.22, 0.28], [2.25, 0.55], [2.18, 0.72], [0.95, 0.84], [-1.65, 0.86], [-2.2, 0.82], [-2.27, 0.6]], -W / 2, W / 2, PART.paint);
  b.prism([[-1.6, 0.85], [0.95, 0.83], [0.15, 1.4], [-0.95, 1.42]], -0.72, 0.72, PART.glass);
  b.box(1.12, 0.05, 1.42, -0.4, 1.43, 0, PART.paint);
  for (const s of [-1, 1]) {
    b.bar([0.95, 0.84], [0.15, 1.41], s * 0.715, 0.07, 0.04, PART.paint);
    b.bar([-1.6, 0.86], [-0.95, 1.42], s * 0.715, 0.12, 0.04, PART.paint);
  }
  b.box(4.1, 0.03, W + 0.016, -0.1, 0.62, 0, PART.trim);                                       // belt-line rubbing strip
  b.box(0.1, 0.56, 1.46, -0.35, 1.13, 0, PART.paint);                                        // B pillar
  for (const x of [-1.38, 1.38]) b.wheel(x, 0.31, W / 2 + 0.02, 0.74);
  b.ends({ front: 2.24, rear: -2.26, width: W, bumperY: 0.36, head: [0.66, 0.09, 0.42, 0.56], tail: [0.7, 0.1, 0.4, 0.6], mirrorX: 0.8, mirrorY: 0.95 });
}

export const BODY_TYPES: BodyType[] = [
  {
    name: 'sedan', weight: 0.4,
    paints: ['car_white', 'car_white', 'car_black', 'car_black', 'car_grey', 'car_silver', 'car_silver', 'car_navy', 'car_red', 'car_green', 'car_beige'],
    build: sedan,
  },
  {
    // Kei car: short, narrow and tall, a stubby bonnet and an upright tailgate.
    name: 'kei', weight: 0.25,
    paints: ['car_white', 'car_silver', 'paint_mint', 'paint_cream', 'paint_blue', 'car_beige', 'car_red', 'car_yellow'],
    build(b) {
      const W = 1.48;
      b.prism([[-1.7, 0.28], [1.66, 0.28], [1.7, 0.5], [1.62, 0.72], [1.2, 0.82], [-1.7, 0.86]], -W / 2, W / 2, PART.paint);
      b.prism([[-1.68, 0.85], [1.2, 0.81], [0.62, 1.55], [-1.62, 1.6]], -0.68, 0.68, PART.glass);
      b.box(2.15, 0.05, 1.38, -0.5, 1.6, 0, PART.paint);
      for (const s of [-1, 1]) {
        b.bar([1.2, 0.82], [0.62, 1.56], s * 0.675, 0.07, 0.04, PART.paint);
        b.bar([-1.68, 0.86], [-1.62, 1.6], s * 0.675, 0.14, 0.04, PART.paint);
      }
      b.box(0.1, 0.72, 1.38, -0.15, 1.2, 0, PART.paint);
      b.box(0.14, 0.72, 1.38, -1.15, 1.22, 0, PART.paint);
      for (const x of [-1.12, 1.12]) b.wheel(x, 0.27, W / 2 + 0.02, 0.66);
      b.ends({ front: 1.68, rear: -1.71, width: W, bumperY: 0.34, head: [0.64, 0.16, 0.26, 0.5], tail: [0.62, 0.3, 0.12, 0.62], mirrorX: 1.05, mirrorY: 0.92 });
    },
  },
  {
    // Delivery van: a short cab with a steep screen ahead of a tall box with small side windows.
    name: 'van', weight: 0.15,
    paints: ['car_white', 'car_white', 'car_silver', 'car_grey', 'car_navy'],
    build(b) {
      const W = 1.7;
      b.prism([[-2.35, 0.3], [2.32, 0.3], [2.35, 0.55], [2.3, 0.98], [-2.35, 1.0]], -W / 2, W / 2, PART.paint);
      b.prism([[1.25, 0.98], [2.3, 0.97], [1.95, 1.9], [1.25, 1.92]], -0.82, 0.82, PART.glass);
      b.box(3.6, 0.96, W, -0.55, 1.48, 0, PART.paint);
      b.box(0.78, 0.05, 1.62, 1.62, 1.93, 0, PART.paint);
      for (const s of [-1, 1]) {
        b.bar([2.3, 0.98], [1.95, 1.91], s * 0.815, 0.08, 0.04, PART.paint);
        b.box(0.03, 0.9, 0.02, -0.05, 1.42, s * (W / 2 + 0.008), PART.trim);                   // sliding door seam
      }
      b.box(4.5, 0.03, W + 0.016, -0.05, 0.62, 0, PART.trim);
      for (const x of [0.6, -0.75]) b.box(1.0, 0.42, W + 0.02, x, 1.6, 0, PART.glass);
      b.box(0.02, 0.42, 1.3, -2.355, 1.6, 0, PART.glass);
      for (const x of [-1.5, 1.55]) b.wheel(x, 0.31, W / 2 + 0.02, 0.76);
      b.ends({ front: 2.34, rear: -2.36, width: W, bumperY: 0.38, head: [0.76, 0.14, 0.3, 0.6], tail: [0.78, 0.42, 0.12, 0.75], mirrorX: 1.95, mirrorY: 1.18 });
    },
  },
  {
    // Taxi: the sedan with a lit roof sign, a red vacancy lamp behind the screen, a contrasting stripe.
    name: 'taxi', weight: 0.2,
    paints: ['car_yellow', 'car_orange', 'car_green', 'car_black', 'car_navy'],
    build(b) {
      sedan(b);
      b.box(0.22, 0.17, 0.44, -0.4, 1.54, 0, PART.roofLight);
      b.box(0.04, 0.06, 0.2, 0.86, 0.93, -0.4, PART.vacancy);
      b.box(3.4, 0.08, 1.762, -0.15, 0.74, 0, PART.stripe);
    },
  },
];

/** Body type of a car from its seed (0..1). The paint uses a different hash of the same seed. */
export function bodyTypeOf(seed: number): number {
  const total = BODY_TYPES.reduce((n, t) => n + t.weight, 0);
  let at = seed * total;
  for (let k = 0; k < BODY_TYPES.length; k++) { at -= BODY_TYPES[k].weight; if (at < 0) return k; }
  return BODY_TYPES.length - 1;
}
