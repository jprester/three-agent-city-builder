import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, cameraPosition, clamp, cos, dFdx, dFdy, distance, dot, exp, float, floor, fract, fwidth, int, length, mat2, max, min, mix,
  normalize, positionWorld, pow, property, sign, sin, smoothstep, step, texture, uniform, uniformArray, vec2, vec3, vec4,
} from './tsl';
import { CAR_LIGHTS } from '../materials/ground';
import { P, colorNode, hash21, mapUv, noise2, paletteColor, type N, type PaletteName } from './tsl';

/** Inputs every ground variant shares. */
export interface GroundShared {
  time: N;
  /** Rain strength (src/scene/night.ts): puddle ripples follow it. */
  rain: N;
  lampMap: THREE.Texture;
  signMap: THREE.Texture;
  lampRect: N;
  reflection: THREE.Texture;
  /** World position to reflection-target UV (src/poc/reflection.ts). */
  reflMatrix: THREE.Matrix4;
  /** Nearest road vehicles: x, z, heading sin, cos (length 2 = braking; zero = none). */
  cars: THREE.Vector4[];
}

export interface GroundVariant {
  color: PaletteName;
  roughness: number;
  pool?: number;
  wet?: number;
  /** The ground plane only: the lights of the mainland towns across the water. */
  sprawl?: boolean;
  /** One clean mirror broken by slow swell. */
  water?: boolean;
}

/**
 * Asphalt, sidewalk, paint and water as a node material: the port of src/materials/ground.ts.
 * Sodium pools from the lamp map, coloured pools from the sign map, the wet-street reflection
 * (the planar reflection smeared vertically, strongest in puddles and at grazing angles), rain
 * ripples, car headlight cones and glare streaks, and the mainland's town lights.
 */
export function createGroundMaterial(v: GroundVariant, s: GroundShared): THREE.MeshStandardNodeMaterial {
  const pool = v.pool ?? 1, wet = v.wet ?? 1;
  const baseColor = colorNode(paletteColor(v.color));
  const SODIUM = P('sodium'), RED = P('sign_red'), TUNGSTEN = P('tungsten'), FLUOR = P('fluorescent'), RIDGE = P('ridge');
  const lampTex = texture(s.lampMap) as N, signTex = texture(s.signMap) as N, reflTex = texture(s.reflection) as N;
  const uRefl = uniform(s.reflMatrix);
  const uCars = uniformArray(s.cars);
  const pEmit = property('vec3') as N, pRough = property('float') as N;
  const headCol = vec3(1.0, 0.95, 0.85);

  const surface = Fn(() => {
    const world = positionWorld;
    const xz = world.xz;
    const puddle = (v.water ? float(1) : mix(
      smoothstep(0.55, 0.66, noise2(xz.mul(0.12)).mul(0.65).add(noise2(xz.mul(0.5)).mul(0.35))),
      // Far away the puddle pattern is sub-pixel: fade to its mean coverage instead of mottling.
      0.25, smoothstep(0.03, 0.15, length(fwidth(xz.mul(0.12)))))).toVar();
    const diffuse = baseColor.mul(mix(0.8, 0.45, puddle)).toVar();
    if (v.sprawl) diffuse.assign(mix(diffuse, RIDGE, smoothstep(2, 35, world.y)));
    pRough.assign(mix(v.roughness, 0.08, puddle));

    const uv = mapUv(xz, s.lampRect);
    const lamp = lampTex.sample(uv).r;
    const emit = diffuse.mul(SODIUM).mul(lamp).mul(lamp).mul(6 * pool).toVar();
    emit.addAssign(diffuse.mul(signTex.sample(uv).rgb).mul(3 * pool));

    // Wet reflection. The noise normal breaks the mirror up; taps spread along the reflection
    // image's vertical axis give the long smears of lights on wet roads.
    const rp = uRefl.mul(vec4(world.x, 0, world.z, 1));
    // three addresses render-target textures top-down on both backends, the matrix yields v up.
    const ruv = vec2(rp.x.div(rp.w), rp.y.div(rp.w).oneMinus()).toVar();
    const gN = vec2(noise2(xz.mul(1.9)), noise2(xz.mul(1.9).add(11.3))).sub(0.5);
    // Rain ripples: rings expanding in a jittered 0.7 m grid, each on its own cycle (puddles only).
    const cell = floor(xz.div(0.7)).toVar();
    const off = vec2(hash21(cell), hash21(cell.add(5.1))).mul(0.5).add(0.1);
    const ph = fract(s.time.mul(1.1).add(hash21(cell.add(9.7)))).toVar();
    const ringD = length(xz.sub(cell.add(off).mul(0.7)));
    const ringX = ringD.sub(ph.mul(0.3)).div(0.018);
    const ring = exp(ringX.mul(ringX).negate()).mul(ph.oneMinus()).mul(puddle).mul(step(hash21(cell.add(2.9)), s.rain))
      .mul(smoothstep(0.02, 0.08, length(fwidth(xz))).oneMinus());   // gone before it aliases
    ruv.addAssign(ring.mul(0.012));
    ruv.addAssign(gN.mul(vec2(mix(0.003, 0.0012, puddle), mix(0.012, 0.003, puddle))));
    let span: N = mix(0.08, 0.018, puddle);
    if (v.water) {
      // Swell: slow waves stretched across the view wobble the mirror sideways, more upward.
      const swell = vec2(
        noise2(xz.mul(vec2(0.3, 0.09)).add(vec2(s.time.mul(0.22), 0))),
        noise2(xz.mul(vec2(0.09, 0.3)).add(vec2(0, s.time.mul(0.18)))),
      ).sub(0.5);
      ruv.addAssign(swell.mul(vec2(0.008, 0.03)).mul(smoothstep(0.5, 6, length(fwidth(xz))).mul(0.7).oneMinus()));
      span = float(0.06);
    }
    const refl = vec3(0).toVar();
    let weight = 0;
    for (let i = -6; i <= 6; i++) {
      const o = i / 6, w = Math.exp(-Math.abs(o) * 2.2);
      refl.addAssign(reflTex.sample(clamp(ruv.add(vec2(0, span.mul(o))), 0.001, 0.999)).level(0).rgb.mul(w));
      weight += w;
    }
    refl.divAssign(weight);
    const view = normalize(cameraPosition.sub(world));
    const fresnel = pow(clamp(view.y, 0, 1).oneMinus(), 5).mul(0.96).add(0.04).toVar();
    // Asphalt grain breaks up the dull wet film; puddles stay clean.
    const grain = mix(noise2(xz.mul(7)).mul(noise2(xz.mul(2.1).add(3))).mul(0.9).add(0.45), 1, puddle);
    emit.addAssign(refl.mul(grain).mul(mix(0.16, 1, puddle)).mul(fresnel.mul(0.75).add(0.25)).mul(wet).mul(smoothstep(0.5, 8, world.y).oneMinus()));

    if (!v.water) {
      // Car lights: a widening headlight cone ahead of each nearby car, a small red glow
      // behind, and on the wet road the glare streak a lamp facing the viewer leaves toward them.
      const head = float(0).toVar(), tail = float(0).toVar(), headGlare = float(0).toVar(), tailGlare = float(0).toVar();
      Loop(CAR_LIGHTS, ({ i }: { i: N }) => {
        const c = uCars.element(int(i));
        const d = xz.sub(c.xy).toVar();
        If(dot(c.zw, c.zw).greaterThanEqual(0.5).and(dot(d, d).lessThanEqual(900)), () => {
          // Heading length 2 marks a braking car (src/systems/vehicles.ts).
          const hl = length(c.zw), brk = step(1.5, hl);
          const hd = c.zw.div(hl).toVar();
          const al = dot(d, hd).toVar(), si = dot(d, vec2(hd.y.negate(), hd.x)).toVar();
          const w = max(al, 0).mul(0.3).add(0.7);
          head.addAssign(exp(si.mul(si).negate().div(w.mul(w))).mul(smoothstep(2, 4.5, al)).mul(pow(max(al.div(30).oneMinus(), 0), 2)).mul(6).div(max(al, 0).mul(0.25).add(1)));
          tail.addAssign(exp(si.mul(si).div(-1.4)).mul(smoothstep(1.8, 2.6, al.negate())).mul(max(al.negate().sub(2.3).div(5).oneMinus(), 0)).mul(brk.mul(2).add(1)));
          const toCam = cameraPosition.xz.sub(c.xy);
          const camDist = length(toCam).toVar();
          const u = toCam.div(max(camDist, 1e-3)).toVar();
          const facing = dot(hd, u).toVar();
          // From the lamp end facing the viewer, along the line to them.
          const q = xz.sub(c.xy.add(hd.mul(sign(facing)).mul(2.3))).toVar();
          const along = dot(q, u).toVar(), lat = dot(q, vec2(u.y.negate(), u.x));
          const streak = exp(lat.mul(lat).div(-0.35)).mul(smoothstep(0, 1, along)).mul(exp(along.div(-14))).mul(step(along, camDist.sub(2.3)));
          headGlare.addAssign(streak.mul(max(facing, 0)).mul(max(facing, 0)));
          tailGlare.addAssign(streak.mul(max(facing.negate(), 0)).mul(max(facing.negate(), 0)).mul(brk.mul(1.5).add(1)));
        });
      });
      const low = smoothstep(0.3, 2, world.y).oneMinus();
      emit.addAssign(diffuse.mul(headCol.mul(head).mul(7).add(RED.mul(tail).mul(4))).mul(low).mul(pool));
      const glare = mix(0.25, 1, puddle).mul(fresnel.mul(0.7).add(0.3)).mul(wet).mul(low);
      emit.addAssign(headCol.mul(headGlare).mul(0.9).add(RED.mul(tailGlare).mul(0.7)).mul(glare));
    }

    if (v.sprawl) {
      // Towns on the mainland hills across the water, as light on the ground only: clusters on
      // the lower slopes, on 520 m patches of street grid, as lamp dots along the streets and
      // window dots inside the blocks. Points keep a minimum size and fade before they alias.
      const sBand = smoothstep(0.3, 3, world.y).mul(smoothstep(20, 80, world.y).oneMinus()).mul(smoothstep(0.42, 0.68, noise2(xz.div(380).add(2)))).toVar();
      const fwA = length(dFdx(xz)), fwB = length(dFdy(xz));
      const fw = max(max(fwA, fwB), 1e-3).toVar(), fwMin = max(min(fwA, fwB), 1e-3).toVar();
      If(sBand.greaterThan(0), () => {
        const patchId = floor(xz.div(520)).toVar();
        const h1 = hash21(patchId), h2 = hash21(patchId.add(7.7)), h3 = hash21(patchId.add(3.3));
        const ang = h1.sub(0.5).mul(1.6).toVar();
        const gp = mat2(cos(ang), sin(ang).negate(), sin(ang), cos(ang)).mul(xz).toVar();
        gp.addAssign(vec2(noise2(xz.div(300)), noise2(xz.div(300).add(9))).sub(0.5).mul(36));
        const B = mix(55, 95, h2).toVar();
        const cellF = fract(gp.div(B));
        const dEdge = min(cellF, cellF.oneMinus()).mul(B).toVar();
        const dens = mix(0.35, 1, smoothstep(0.15, 0.65, noise2(xz.div(900).add(4)))).mul(h3.mul(0.3).add(0.7)).mul(exp(length(xz).div(-6000)));
        const dS = min(dEdge.x, dEdge.y);
        const ly = fract(gp.y.div(28).add(0.5)).sub(0.5).abs().mul(28), lx = fract(gp.x.div(28).add(0.5)).sub(0.5).abs().mul(28);
        const dl = min(length(vec2(dEdge.x, ly)), length(vec2(dEdge.y, lx)));
        const lr = max(0.9, fwMin.mul(0.5)).toVar();
        const lampDot = mix(smoothstep(lr.mul(0.3), lr, dl).oneMinus().mul(float(0.9).div(lr)), 0.01, smoothstep(6, 14, fw));
        const wg = gp.div(9).toVar();
        const wi = floor(wg).toVar();
        const wLit = step(hash21(wi.add(patchId.mul(1.7))), 0.5).mul(step(5.5, dS));
        const wo = vec2(hash21(wi.add(2.3)), hash21(wi.add(5.9))).mul(5).add(2);
        const wr = max(0.8, fwMin.mul(0.6)).toVar();
        const wd = length(wg.sub(wi).mul(9).sub(wo));
        const win = mix(smoothstep(wr.mul(0.25), wr, wd).oneMinus().mul(wLit).mul(float(0.8).div(wr)).mul(hash21(wi.add(3.7)).mul(0.8).add(0.6)), 0.03, smoothstep(2.5, 5, fw));
        const wCol = mix(TUNGSTEN, FLUOR, step(0.7, hash21(wi.add(11))));
        const light = SODIUM.mul(lampDot).mul(2.2).add(wCol.mul(win).mul(2.6));
        // Painted lights on flat ground only hold up from a distance: fade in away from the camera.
        const sNear = smoothstep(60, 220, distance(cameraPosition, world));
        emit.addAssign(light.mul(dens).mul(sBand).mul(sNear).mul(1.2));
      });
    }
    pEmit.assign(emit);
    return diffuse;
  });

  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  material.name = `ground-${v.color}`;
  material.colorNode = surface();
  material.roughnessNode = pRough;
  material.emissiveNode = pEmit;
  return material;
}

/** The ground variants of src/scene/streets.ts by mesh name. */
export const GROUND_VARIANTS: Record<string, GroundVariant> = {
  ground: { color: 'road_wet', roughness: 0.35, sprawl: true },
  island: { color: 'road_wet', roughness: 0.35, sprawl: true },
  sidewalks: { color: 'sidewalk', roughness: 0.8, pool: 0.8, wet: 0.35 },
  promenade: { color: 'sidewalk', roughness: 0.8, pool: 0.8, wet: 0.35 },
  quay: { color: 'sidewalk', roughness: 0.8, pool: 0.8, wet: 0.35 },
  markings: { color: 'paint', roughness: 0.7, wet: 0.5 },
  water: { color: 'water', roughness: 0.1, pool: 0.15, wet: 1.3, water: true },
};
