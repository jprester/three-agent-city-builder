import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, abs, asin, atan, attribute, cameraPosition, clamp, dot, exp, float, floor, fract, fwidth, length, max, mix, mod, normalize,
  positionLocal, pow, select, smoothstep, step, uniform, uniformArray, varying, vec2, vec3,
} from './tsl';
import type { Layout } from '../systems/layout';
import { P, noise3, hash31, type N } from './tsl';

export interface Sky {
  mesh: THREE.Mesh;
  flash: { value: number };
  flashDir: { value: THREE.Vector2 };
}

/**
 * The night sky dome of src/scene/sky.ts as a node material: zenith-to-haze gradient, a cloud
 * deck lit warm from below by the districts, two mountain ridges, the lights of distant
 * settlements and lightning inside the deck. The dome is drawn around whichever camera renders
 * (the vertex stage adds the camera position), so the mirrored reflection camera needs no
 * per-render hook.
 */
export function createSky(time: N, layout: Layout | null): Sky {
  const districts = ['core', 'towers', 'port'].map((name, i) => {
    const origin = layout?.anchors?.[name]?.origin ?? [0, 0, 0];
    return new THREE.Vector4(origin[0], 650, origin[2], [1, 0.85, 0.3][i]);
  });
  const uDistricts = uniformArray(districts);
  const uFlash = uniform(0);
  const uFlashDir = uniform(new THREE.Vector2(1, 0));
  const zenith = P('sky'), horizon = P('haze'), glowCol = P('sodium'), tungsten = P('tungsten');
  const fluor = P('fluorescent'), red = P('sign_red'), cloudGlow = P('cloud_glow'), ridgeCol = P('ridge');
  const CLOUD_GAIN = 0.32;

  const clouds = Fn(([q0]: N[]) => {
    const q = vec3(q0).toVar();
    const n = float(0).toVar(), amplitude = float(0.55).toVar();
    Loop(4, () => {
      n.addAssign(noise3(q).mul(amplitude));
      q.assign(q.mul(2.13).add(vec3(7.1, 3.7, 9.2)));
      amplitude.mulAssign(0.48);
    });
    return n;
  });
  const hash2 = (p: N) => hash31(vec3(p, 17.0));
  const n1 = (x: N, y: N) => noise3(vec3(x, y, 0));

  // Distant settlements on the horizon: clusters of tiny warm and white lights with gaps
  // between them, a faint glow over the dense ones and a few slow red aviation blinks.
  const distantLights = Fn(([e, az, base, layer]: N[]) => {
    const out = vec3(0).toVar();
    If(e.greaterThanEqual(0).and(e.lessThanEqual(0.09)), () => {
      const town = smoothstep(0.55, 0.8, n1(az.mul(2.2), layer.mul(7).add(3)).mul(0.7).add(n1(az.mul(9), layer.mul(11).add(7)).mul(0.45))).toVar();
      const foot = base.add(n1(az.mul(17), layer.add(31)).mul(0.005));
      const localE = e.sub(foot).toVar();
      const top = float(0.002).add(town.mul(0.018).mul(pow(n1(az.mul(40), layer.add(11)), 2))).toVar();
      const band = smoothstep(0, 0.002, localE).mul(smoothstep(top, top.add(0.002), localE).oneMinus()).toVar();
      const lights = vec3(0).toVar();
      for (let k = 0; k < 2; k++) {
        const g = vec2(az.add(layer.mul(3.7)), localE).mul(k === 0 ? vec2(260, 900) : vec2(370, 1300)).toVar();
        const cell = floor(g).toVar();
        const f = fract(g).sub(0.5);
        const h = hash2(cell.add(k * 91)).toVar();
        const lit = step(h, town.mul(0.26)).mul(band);
        const jit = vec2(hash2(cell.add(5.3)), hash2(cell.add(9.1))).sub(0.5);
        const r = length(f.sub(jit.mul(0.6)).mul(vec2(1, 0.45))).toVar();
        const w = fwidth(r).add(0.02);
        const spot = smoothstep(float(0.16).sub(w), float(0.16).add(w), r).oneMinus().mul(lit);
        const tint = hash2(cell.add(2.7));
        const c = select(tint.lessThan(0.55), glowCol, select(tint.lessThan(0.85), tungsten, fluor));
        lights.addAssign(c.mul(spot).mul(float(0.2).add(hash2(cell.add(4.4)).mul(hash2(cell.add(8.8))).mul(0.6))));
        const av = step(0.997, h).mul(town).mul(band);
        lights.addAssign(red.mul(av).mul(smoothstep(0, 0.2, r).oneMinus()).mul(step(0.5, fract(time.mul(0.5).add(h.mul(7))))));
      }
      const glow = glowCol.mul(0.012).mul(town).mul(exp(abs(localE).mul(-160)));
      out.assign(lights.add(glow).mul(0.65));
    });
    return out;
  });

  // Mountain ridges behind the tower district: (near, far) heights as elevation angles.
  const RIDGE_AZ = -0.9, RIDGE_HALF = 1.75;
  const ridgeNoise = (az: N, f: number, seed: number) =>
    n1(az.mul(f), seed).mul(0.6).add(n1(az.mul(f * 2.7), seed + 4).mul(0.28)).add(n1(az.mul(f * 7.9), seed + 9).mul(0.12));
  const ridges = Fn(([az]: N[]) => {
    const da = abs(mod(az.sub(RIDGE_AZ).add(Math.PI), 2 * Math.PI).sub(Math.PI));
    const sector = smoothstep(RIDGE_HALF * 0.55, RIDGE_HALF, da).oneMinus().toVar();
    const nearH = float(0.005).add(pow(ridgeNoise(az, 3.1, 1), 1.6).mul(0.065)).mul(sector);
    const farH = float(0.014).add(pow(ridgeNoise(az, 1.7, 21), 1.4).mul(0.1)).mul(sector);
    return vec2(nearH, farH);
  });

  const cityGlow = Fn(([d]: N[]) => {
    const glow = float(0).toVar();
    for (let i = 0; i < 3; i++) {
      const dv = uDistricts.element(i);
      const delta = dv.xyz.sub(cameraPosition).toVar();
      const facing = max(dot(d, delta.div(max(length(delta), 0.001))), 0);
      glow.addAssign(pow(facing, 3).mul(dv.w).div(dot(delta, delta).div(1800000).add(1)));
    }
    return clamp(glow, 0, 1);
  });

  // The raw sphere vertex: positionLocal is reassigned by the position node below.
  const vDir = varying(attribute('position', 'vec3'));
  const skyColor = Fn(() => {
    const d = normalize(vDir).toVar();
    const y = max(d.y, 0).toVar();
    const col = mix(horizon, zenith, smoothstep(0, 0.4, pow(y, 0.65))).toVar();
    // Angular 3D noise avoids the stretched horizon bands of a projected flat deck.
    const q = d.mul(vec3(5, 6.5, 5)).add(vec3(time.mul(0.0015), 0, 0)).toVar();
    q.addAssign(vec3(noise3(q.mul(0.6)), noise3(q.mul(0.6).add(13)), noise3(q.mul(0.6).add(27))).mul(1.2));
    const cloud = clouds(q).toVar();
    const deck = smoothstep(0.25, 0.7, cloud).mul(smoothstep(0, 0.1, y)).toVar();
    const edge = max(0, clouds(q.add(vec3(0, -0.18, 0))).sub(cloud)).toVar();
    col.assign(mix(col, mix(zenith, horizon, 0.35).mul(0.75), deck.mul(0.4)));
    col.addAssign(horizon.mul(1.5).add(glowCol.mul(0.018)).mul(deck.mul(0.3).add(edge.mul(1.5))).mul(exp(y.mul(-2.2))));
    // City light from below: cloud bases glow warm, most where they hang low over the horizon.
    const under = deck.mul(float(0.3).add(exp(y.mul(-4)).mul(0.7))).add(edge.mul(1.5).mul(exp(y.mul(-3))));
    col.addAssign(cloudGlow.mul(under).mul(CLOUD_GAIN).mul(float(0.35).add(cityGlow(d).mul(0.65))));
    // Lightning lights the deck from inside, strongest toward the strike.
    const flat = d.xz.div(max(length(d.xz), 1e-3));
    const toward = pow(max(dot(flat, uFlashDir), 0), 6);
    const lit = uFlash.mul(float(0.08).add(toward.mul(0.92).mul(exp(y.mul(-1.5)))));
    col.addAssign(vec3(0.72, 0.78, 1.0).mul(lit).mul(deck.mul(1.1).add(edge.mul(3)).add(exp(y.mul(-2.5)).mul(0.12))).mul(0.42));
    col.assign(select(d.y.lessThan(0), horizon, col));
    // Ridges: silhouettes against the lit cloud, lifted toward the haze at their foot.
    const e = asin(clamp(d.y, -1, 1)).toVar();
    const aa = fwidth(e).mul(1.5).add(1e-5).toVar();
    // atan(z, x) is undefined straight up; the ridges only exist near the horizon anyway.
    const nearHorizon = abs(e).lessThan(0.13);
    const az = atan(d.z, select(nearHorizon, d.x, float(1))).toVar();
    const rh = select(nearHorizon, ridges(az), vec2(0)).toVar();
    const above = step(0, e);
    const farM = smoothstep(rh.y.sub(aa), rh.y.add(aa), e).oneMinus().mul(above);
    const nearM = smoothstep(rh.x.sub(aa), rh.x.add(aa), e).oneMinus().mul(above);
    const foot = mix(horizon, cloudGlow.mul(0.35), 0.35);
    const ep = max(e, 0).toVar();
    const aboveFog = smoothstep(0, 0.018, ep);
    const farCol = mix(horizon, mix(ridgeCol, foot, float(0.55).add(exp(ep.mul(-60)).mul(0.35))), aboveFog);
    const nearCol = mix(horizon, mix(ridgeCol, foot, float(0.2).add(exp(ep.mul(-90)).mul(0.5))), aboveFog);
    col.assign(mix(col, farCol, farM));
    col.addAssign(distantLights(e, az, rh.y.mul(0.32).add(0.004), float(0)));
    col.assign(mix(col, nearCol, nearM));
    col.addAssign(distantLights(e, az, rh.x.mul(0.22).add(0.002), float(1)));
    return col;
  });

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  material.name = 'sky';
  material.positionNode = positionLocal.add(cameraPosition);
  material.colorNode = skyColor();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, flash: uFlash, flashDir: uFlashDir };
}
