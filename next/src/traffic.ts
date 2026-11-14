import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../art/layouts/lib/rng.mjs';
import type { Plan } from './plan';
import {
  Fn, If, attribute, clamp, exp, float, instanceIndex, instancedArray, int, max, min, mix, mod, select, smoothstep, step, texture, uniform,
  uniformArray, varying, vec2, vec3,
  P, fract, mapUv, paletteColor, type N,
} from './tsl';
import { BODY_TYPES, BodyBuilder, PART, bodyTypeOf } from './vehicles';

const CAR_LENGTH = 4.4;
/** Stop lines per lane, in vec4s: room for 12 crossings. */
const STOP_SLOTS = 3;
export interface Traffic {
  /** One instanced draw per body type. */
  cars: THREE.Group;
  /** Headlight pools on the road, one additive quad per car. */
  pools: THREE.Mesh;
  count: number;
  update(renderer: THREE.WebGPURenderer, dt: number, time: number): void;
}

/**
 * Traffic on the GPU. Each car is four numbers in a storage buffer (distance along its lane,
 * speed, lane, seed); a compute pass advances every car each frame, keeping its distance from
 * the car ahead in the same buffer and stopping at red signals. Lanes, stop lines and the
 * signal cycle come from the plan. The vertex stage places the car model from the same buffer,
 * so nothing about a car ever touches JavaScript after start-up. Each body type (vehicles.ts) is
 * its own draw, reading its cars through a list of their indices; the type is fixed per car
 * by its seed when the buffer is filled.
 */
export function createTraffic(plan: Plan, lampMap: THREE.Texture, lampRect: N): Traffic {
  const rng = mulberry32((plan.seed ^ 0x7e41c1e5) >>> 0);
  const count = plan.lanes.reduce((n, l) => n + l.cars, 0);
  const state = new Float32Array(count * 4), meta = new Float32Array(count * 4);
  const mainEdge = plan.main.half + plan.main.sidewalk, crossEdge = plan.cross.half + plan.cross.sidewalk, backEdge = plan.back.half + plan.back.sidewalk;
  let i = 0;
  const byType: number[][] = BODY_TYPES.map(() => []);
  const laneA: THREE.Vector4[] = [], laneB: THREE.Vector4[] = [], stops: THREE.Vector4[] = [];
  plan.lanes.forEach((lane, li) => {
    laneA.push(new THREE.Vector4(lane.x, lane.z, lane.dx, lane.dz));
    laneB.push(new THREE.Vector4(lane.length, lane.phase, lane.speed, 0));
    // Stop lines as distances along the lane (-1: unused), STOP_SLOTS vec4s per lane. Lanes along x
    // stop before every cross street; lanes along z before the main street and every back street.
    const s = lane.dx !== 0
      ? plan.cross.xs.map((cx) => lane.dx * (cx - lane.dx * (crossEdge + 5.5) - lane.x))
      : [lane.dz * (-lane.dz * (mainEdge + 5.5) - lane.z), ...plan.back.zs.map((bz) => lane.dz * (bz - lane.dz * (backEdge + 4) - lane.z))];
    if (s.length > STOP_SLOTS * 4) throw new Error(`a lane crosses ${s.length} streets; raise STOP_SLOTS`);
    while (s.length < STOP_SLOTS * 4) s.push(-1);
    for (let k = 0; k < STOP_SLOTS; k++) stops.push(new THREE.Vector4(s[4 * k], s[4 * k + 1], s[4 * k + 2], s[4 * k + 3]));
    const first = i;
    for (let k = 0; k < lane.cars; k++, i++) {
      const seed = rng();
      state.set([((k + 0.15 + 0.7 * rng()) / lane.cars) * lane.length, lane.speed, li, seed], i * 4);
      byType[bodyTypeOf(seed)].push(i);
      // The car ahead is the next index; the last car of a lane follows the first.
      meta.set([k === lane.cars - 1 ? first : i + 1, 0, 0, 0], i * 4);
    }
  });
  const sBuf = instancedArray(state, 'vec4') as N, mBuf = instancedArray(meta, 'vec4') as N;
  const uLaneA = uniformArray(laneA), uLaneB = uniformArray(laneB), uStops = uniformArray(stops);
  const uDt = uniform(0), uTime = uniform(0);
  const { period, green, amber } = plan.signal;

  const simulate = Fn(() => {
    const st = sBuf.element(instanceIndex), me = mBuf.element(instanceIndex);
    const lane = int(st.z);
    const L = uLaneB.element(lane).x, phase = uLaneB.element(lane).y, cruise = uLaneB.element(lane).z;
    const ahead = sBuf.element(int(me.x)).x;
    const alone = float(me.x).equal(float(instanceIndex));
    const gap = select(alone, float(999), mod(ahead.sub(st.x).add(L), L).sub(CAR_LENGTH)).toVar();
    // Signal: each phase gets green then amber, the other half of the cycle is red.
    const t = mod(uTime.add(phase.mul(period / 2)), period);
    const isGreen = t.lessThan(green), isAmber = t.greaterThanEqual(green).and(t.lessThan(green + amber));
    for (let k = 0; k < STOP_SLOTS; k++) {
      const stop = uStops.element(lane.mul(STOP_SLOTS).add(k)).toVar();
      for (const s of [stop.x, stop.y, stop.z, stop.w]) {
        const d = mod(s.sub(st.x).add(L), L);
        // Red stops everyone short of the line; amber only those who can still brake.
        const hold = s.greaterThanEqual(0).and(d.lessThan(45)).and(isGreen.not()).and(isAmber.not().or(d.greaterThan(9)));
        If(hold, () => { gap.assign(min(gap, d.sub(0.5))); });
      }
    }
    const target = cruise.mul(clamp(gap.sub(1.5).div(11), 0, 1));
    const v = max(st.y.add(clamp(target.sub(st.y), uDt.mul(-7), uDt.mul(2.6))), 0);
    me.y.assign(step(target, st.y.sub(0.4)));      // braking: lights the tail lamps
    st.y.assign(v);
    st.x.assign(mod(st.x.add(v.mul(uDt)), L));
  });
  const computeNode = simulate().compute(count);

  // --- drawing: each body type placed along its lane in the vertex stage ---
  const placeFor = (st: N) => {
    const a = uLaneA.element(int(st.z));
    const origin = vec3(a.x, 0, a.y), dir = vec3(a.z, 0, a.w), perp = vec3(a.w.negate(), 0, a.z);
    return { dir, perp, place: (local: N): N => origin.add(dir.mul(st.x.add(local.x))).add(perp.mul(local.z)).add(vec3(0, local.y, 0)) };
  };
  const lp = attribute('position', 'vec3') as N, ln = attribute('normal', 'vec3') as N;
  const flat = (node: N): N => varying(node).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.FIRST);
  const lampTex = texture(lampMap) as N;
  const cars = new THREE.Group();
  cars.name = 'cars';
  BODY_TYPES.forEach((type, t) => {
    const ids = byType[t];
    if (!ids.length) return;
    const idBuf = instancedArray(new Float32Array(ids), 'float') as N;
    const index = int(idBuf.element(instanceIndex));
    const st = sBuf.element(index), me = mBuf.element(index);
    const { dir, perp, place } = placeFor(st);
    const vPart = flat(attribute('part', 'float')), vSeed = flat(st.w), vBrake = flat(me.y), vEnd = flat(ln.x.abs());
    const worldN = dir.mul(ln.x).add(perp.mul(ln.z)).add(vec3(0, ln.y, 0));
    const vShade = varying(vec2(ln.y, worldN.dot(vec3(0.4, 0.7, -0.3)))) as N;
    const vWorld = varying(place(lp)) as N, vLocalY = varying(lp.y) as N;
    const paints = uniformArray(type.paints.map((n) => paletteColor(n)));
    const is = (part: number) => step(part - 0.5, vPart).mul(step(vPart, part + 0.5));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = `cars-${type.name}`;
    material.positionNode = place(lp);
    material.colorNode = Fn(() => {
      // The paint uses another hash of the seed than the type does, so paint and type are independent.
      const paint = paints.element(int(fract(vSeed.mul(53.17)).mul(type.paints.length)));
      const albedo = vec3(0).toVar();
      albedo.addAssign(paint.mul(is(PART.paint)));
      albedo.addAssign(P('glass_dark').mul(1.4).mul(is(PART.glass)));
      albedo.addAssign(vec3(0.2).mul(is(PART.head).add(is(PART.tail))));
      albedo.addAssign(P('metal_dark').mul(0.5).mul(is(PART.tyre)));
      albedo.addAssign(P('car_black').mul(0.6).mul(is(PART.trim)));
      albedo.addAssign(P('office_white').mul(0.8).mul(is(PART.plate)));
      albedo.addAssign(P('car_silver').mul(is(PART.hub)));
      albedo.addAssign(P('paint_cream').mul(is(PART.stripe)));
      const lamp = lampTex.sample(mapUv(vWorld.xz, lampRect)).r;
      // Street light from above and the sky's cool fill: no light objects.
      const light = P('sodium').mul(lamp.mul(lamp).mul(4).add(lampTex.sample(mapUv(vWorld.xz, lampRect)).bias(4).r.mul(0.5)).add(0.06)).mul(max(vShade.x, 0).mul(0.6).add(0.4)).add(P('haze').mul(1.8).mul(vShade.y.mul(0.5).add(0.7)));
      // Lamps shine from their front and back faces only, so a lamp seen from above does not bloom.
      const head = vec3(1.0, 0.95, 0.85).mul(7).mul(is(PART.head)).mul(vEnd);
      const tail = P('sign_red').mul(mix(1.6, 7, vBrake)).mul(is(PART.tail)).mul(vEnd);
      // Through the glass: a dim warm interior low in the cabin, brighter in a few cars with the dome light on.
      const dome = step(0.8, fract(vSeed.mul(17.31)));
      const inside = P('warm_interior').mul(float(0.035).add(dome.mul(0.12))).mul(smoothstep(1.55, 0.95, vLocalY)).mul(is(PART.glass));
      const signs = P('neon_amber').mul(3).mul(is(PART.roofLight)).add(P('sign_red').mul(5).mul(is(PART.vacancy))).add(vec3(0.25).mul(is(PART.plate)));
      return albedo.mul(light).add(head).add(tail).add(inside).add(signs);
    })();
    const builder = new BodyBuilder();
    type.build(builder);
    const mesh = new THREE.Mesh(builder.build(), material);
    mesh.count = ids.length;
    mesh.frustumCulled = false;
    mesh.name = `cars-${type.name}`;
    cars.add(mesh);
  });

  // Light pools: a soft cone ahead of each car and a red smear behind, added onto the road.
  const { place } = placeFor(sBuf.element(instanceIndex));
  const me = mBuf.element(instanceIndex);
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const corner = attribute('position', 'vec3') as N;
  const vPoolUv = varying(vec2(corner.x.add(0.5), corner.z.add(0.5))) as N;
  const poolMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  poolMat.name = 'car-pools';
  // The quad spans 6 m behind to 22 m ahead of the car's centre, 7 m wide, just above the road.
  poolMat.positionNode = place(vec3(corner.x.mul(28).add(8), 0.03, corner.z.mul(7)));
  poolMat.colorNode = Fn(() => {
    const along = vPoolUv.x.mul(28).sub(6), side = vPoolUv.y.sub(0.5).mul(7);
    const w = max(along, 0).mul(0.22).add(0.7);
    const head = exp(side.mul(side).negate().div(w.mul(w))).mul(smoothstep(2.2, 4.5, along)).mul(max(float(1).sub(along.div(22)), 0).pow(2));
    const tail = exp(side.mul(side).div(-1.2)).mul(smoothstep(-2.2, -3, along)).mul(max(along.add(6).div(3.8), 0)).mul(mix(1, 3, me.y));
    return vec3(1.0, 0.95, 0.85).mul(head).mul(0.05).add(P('sign_red').mul(tail).mul(0.03));
  })();
  const pools = new THREE.Mesh(poolGeo, poolMat);
  pools.count = count;
  pools.frustumCulled = false;
  pools.renderOrder = 2;
  pools.name = 'car-pools';

  let warmed = false;
  return {
    cars, pools, count,
    update(renderer, dt, time) {
      uTime.value = time;
      if (!warmed) {
        // Let queues form before the first frame, so a frozen-time capture shows real traffic.
        warmed = true;
        uDt.value = 1 / 15;
        for (let k = 0; k < 240; k++) { uTime.value = time - (240 - k) / 15; renderer.compute(computeNode); }
        uTime.value = time;
      }
      uDt.value = Math.min(dt, 0.1);
      if (dt > 0) renderer.compute(computeNode);
    },
  };
}
