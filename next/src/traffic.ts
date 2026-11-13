import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../art/layouts/lib/rng.mjs';
import type { Plan } from './plan';
import {
  Fn, If, attribute, clamp, exp, float, instanceIndex, instancedArray, int, max, min, mix, mod, select, smoothstep, step, texture, uniform,
  uniformArray, varying, vec2, vec3,
  P, mapUv, paletteColor, type N, type PaletteName,
} from './tsl';

const CAR_LENGTH = 4.4;
const PAINTS: PaletteName[] = ['car_white', 'car_white', 'car_black', 'car_black', 'car_grey', 'car_silver', 'car_silver', 'car_navy', 'car_red', 'car_green', 'car_beige', 'car_yellow'];

export interface Traffic {
  cars: THREE.Mesh;
  /** Headlight pools on the road, one additive quad per car. */
  pools: THREE.Mesh;
  count: number;
  update(renderer: THREE.WebGPURenderer, dt: number, time: number): void;
}

/** Car body, cabin, lamps and wheels as one geometry; `part`: 0 paint, 1 glass, 2 headlamp, 3 tail lamp, 4 tyre. Forward is +x. */
function carGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number, part: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
    g.setAttribute('part', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count).fill(part), 1));
    parts.push(g);
  };
  add(CAR_LENGTH, 0.62, 1.78, 0, 0.56, 0, 0);
  add(2.3, 0.52, 1.6, -0.25, 1.12, 0, 1);
  add(2.1, 0.06, 1.5, -0.25, 1.4, 0, 0);
  for (const z of [-0.6, 0.6]) { add(0.06, 0.16, 0.36, CAR_LENGTH / 2 + 0.02, 0.66, z, 2); add(0.06, 0.14, 0.4, -CAR_LENGTH / 2 - 0.02, 0.7, z, 3); }
  for (const x of [-1.35, 1.35]) for (const z of [-0.82, 0.82]) add(0.64, 0.64, 0.22, x, 0.32, z, 4);
  return mergeGeometries(parts, false);
}

/**
 * Traffic on the GPU. Each car is four numbers in a storage buffer (distance along its lane,
 * speed, lane, seed); a compute pass advances every car each frame, keeping its distance from
 * the car ahead in the same buffer and stopping at red signals. Lanes, stop lines and the
 * signal cycle come from the plan. The vertex stage places the car model from the same buffer,
 * so nothing about a car ever touches JavaScript after start-up.
 */
export function createTraffic(plan: Plan, lampMap: THREE.Texture, lampRect: N): Traffic {
  const rng = mulberry32((plan.seed ^ 0x7e41c1e5) >>> 0);
  const count = plan.lanes.reduce((n, l) => n + l.cars, 0);
  const state = new Float32Array(count * 4), meta = new Float32Array(count * 4);
  const mainEdge = plan.main.half + plan.main.sidewalk, crossEdge = plan.cross.half + plan.cross.sidewalk;
  let i = 0;
  const laneA: THREE.Vector4[] = [], laneB: THREE.Vector4[] = [], stops: THREE.Vector4[] = [];
  plan.lanes.forEach((lane, li) => {
    laneA.push(new THREE.Vector4(lane.x, lane.z, lane.dx, lane.dz));
    laneB.push(new THREE.Vector4(lane.length, lane.phase, lane.speed, 0));
    // Stop lines as distances along the lane (-1: unused).
    const s = lane.dx !== 0
      ? plan.cross.xs.map((cx) => lane.dx * (cx - lane.dx * (crossEdge + 5.5) - lane.x))
      : [lane.dz * (-lane.dz * (mainEdge + 5.5) - lane.z), -1, -1, -1];
    stops.push(new THREE.Vector4(...(s as [number, number, number, number])));
    const first = i;
    for (let k = 0; k < lane.cars; k++, i++) {
      state.set([((k + 0.15 + 0.7 * rng()) / lane.cars) * lane.length, lane.speed, li, rng()], i * 4);
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
    const stop = uStops.element(lane);
    for (const s of [stop.x, stop.y, stop.z, stop.w]) {
      const d = mod(s.sub(st.x).add(L), L);
      // Red stops everyone short of the line; amber only those who can still brake.
      const hold = s.greaterThanEqual(0).and(d.lessThan(45)).and(isGreen.not()).and(isAmber.not().or(d.greaterThan(9)));
      If(hold, () => { gap.assign(min(gap, d.sub(0.5))); });
    }
    const target = cruise.mul(clamp(gap.sub(1.5).div(11), 0, 1));
    const v = max(st.y.add(clamp(target.sub(st.y), uDt.mul(-7), uDt.mul(2.6))), 0);
    me.y.assign(step(target, st.y.sub(0.4)));      // braking: lights the tail lamps
    st.y.assign(v);
    st.x.assign(mod(st.x.add(v.mul(uDt)), L));
  });
  const computeNode = simulate().compute(count);

  // --- drawing: the car model placed along its lane in the vertex stage ---
  const st = sBuf.element(instanceIndex), me = mBuf.element(instanceIndex);
  const a = uLaneA.element(int(st.z));
  const origin = vec3(a.x, 0, a.y), dir = vec3(a.z, 0, a.w), perp = vec3(a.w.negate(), 0, a.z);
  const place = (local: N): N => origin.add(dir.mul(st.x.add(local.x))).add(perp.mul(local.z)).add(vec3(0, local.y, 0));
  const lp = attribute('position', 'vec3') as N, ln = attribute('normal', 'vec3') as N;
  const flat = (node: N): N => varying(node).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.FIRST);
  const vPart = flat(attribute('part', 'float')), vSeed = flat(st.w), vBrake = flat(me.y);
  const worldN = dir.mul(ln.x).add(perp.mul(ln.z)).add(vec3(0, ln.y, 0));
  const vShade = varying(vec2(ln.y, worldN.dot(vec3(0.4, 0.7, -0.3)))) as N;
  const vWorld = varying(place(lp)) as N;
  const paints = uniformArray(PAINTS.map((n) => paletteColor(n)));
  const lampTex = texture(lampMap) as N;

  const carMat = new THREE.MeshBasicNodeMaterial();
  carMat.name = 'cars';
  carMat.positionNode = place(lp);
  carMat.colorNode = Fn(() => {
    const paint = paints.element(int(vSeed.mul(PAINTS.length)));
    const albedo = select(vPart.lessThan(0.5), paint, select(vPart.lessThan(1.5), P('glass_dark').mul(1.4), select(vPart.lessThan(3.5), vec3(0.2), P('metal_dark').mul(0.5))));
    const lamp = lampTex.sample(mapUv(vWorld.xz, lampRect)).r;
    // Street light from above and the sky's cool fill: no light objects.
    const light = P('sodium').mul(lamp.mul(lamp).mul(4).add(lampTex.sample(mapUv(vWorld.xz, lampRect)).bias(4).r.mul(0.5)).add(0.06)).mul(max(vShade.x, 0).mul(0.6).add(0.4)).add(P('haze').mul(1.8).mul(vShade.y.mul(0.5).add(0.7)));
    const head = vec3(1.0, 0.95, 0.85).mul(7).mul(step(1.5, vPart)).mul(step(vPart, 2.5));
    const tail = P('sign_red').mul(mix(1.6, 7, vBrake)).mul(step(2.5, vPart)).mul(step(vPart, 3.5));
    return albedo.mul(light).add(head).add(tail);
  })();
  const cars = new THREE.Mesh(carGeometry(), carMat);
  cars.count = count;
  cars.frustumCulled = false;
  cars.name = 'cars';

  // Light pools: a soft cone ahead of each car and a red smear behind, added onto the road.
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
