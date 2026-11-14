import * as THREE from 'three/webgpu';
import { BAY, PODIUM, SHOP_BAY } from './build';
import { FLOOR_HEIGHT } from './plan';
import {
  Fn, If, abs, attribute, cameraPosition, clamp, dot, exp, float, floor, fract, fwidth, instanceColor, max, min, mix, normalWorld, normalize, positionWorld,
  pow, property, select, smoothstep, step, texture, varying, vec2, vec3, vec4,
  P, box, fixtureSpill, hash21, mapUv, noise2, type N,
} from './tsl';

export interface FacadeInputs {
  time: N;
  lampMap: THREE.Texture;
  signMap: THREE.Texture;
  /** Downward fixtures in three height layers and their mounting heights (lightmaps.ts). */
  fixtureMap: THREE.Texture;
  fixtureHeights: N;
  /** minX, minZ, 1/sizeX, 1/sizeZ of the lamp and sign maps (uniform vec4). */
  lampRect: N;
}

/**
 * One material for every building. The mesh is bare walls; this draws the facade and picks
 * the level of detail per pixel from how large a window is on screen:
 *   near   recessed windows with a parallax room behind the glass, frames, sills, curtains;
 *          shopfronts with lit interiors or shutters on the ground floor of street walls;
 *          tile or concrete with grout, floor bands and grime;
 *   mid    one flat light per window, weighted by pixel coverage so small windows keep their
 *          energy and stay distinct points;
 *   far    the facade's mean light, so the skyline neither shimmers nor goes dark.
 * Nothing is lit by real lights: walls take the street's glow from the top-down lamp and sign
 * maps, a faint city bounce and a sky rim.
 */
export function createFacadeMaterial(inp: FacadeInputs): THREE.MeshStandardNodeMaterial {
  const flat = (node: N): N => varying(node).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.FIRST);
  const vData = flat(attribute('bdata', 'vec4')), vWall = flat(attribute('bwall', 'vec2'));
  const vUv = varying(attribute('uv', 'vec2')) as N;
  const lampTex = texture(inp.lampMap) as N, signTex = texture(inp.signMap) as N;
  const fixtureTex = texture(inp.fixtureMap) as N;
  const pEmit = property('vec3') as N, pRough = property('float') as N, pMetal = property('float') as N;

  const TUNGSTEN = P('tungsten'), FLUOR = P('fluorescent'), OFFICE = P('office_white'), TV = P('tv_blue'), SODIUM = P('sodium');
  const HAZE = P('haze'), SKY = P('sky'), GLASS = P('glass_dark'), METAL = P('metal_dark'), RED = P('sign_red');
  const wallTone = (i: N): N => select(i.lessThan(0.5), P('tile_stained'), select(i.lessThan(1.5), P('concrete'), select(i.lessThan(2.5), P('paint_cream'), P('metal_dark'))));
  const paints = [P('paint_mint'), P('paint_salmon'), P('paint_cream'), P('paint_blue')];
  const skyRefl = (y: N): N => mix(HAZE.mul(1.6).add(SODIUM.mul(0.03)), SKY, smoothstep(0, 0.5, max(y, 0)));
  const windowColor = (h: N): N => select(h.lessThan(0.82), mix(TUNGSTEN, FLUOR, h.mul(0.3).add(0.1)), select(h.lessThan(0.97), mix(FLUOR, TUNGSTEN, 0.35), mix(TV, FLUOR, 0.5)));
  const cover = (x: N, lo: N, hi: N, fp: N): N => clamp(min(x.add(fp.mul(0.5)), hi).sub(max(x.sub(fp.mul(0.5)), lo)).div(fp), 0, 1);

  // A room behind a pane, from nothing but the view ray: back wall with a furniture band and a
  // picture, floor, ceiling with a lamp, side walls. `wp` meters from the window's lower left.
  const room = (wp: N, wsize: N, vt: N, h: N): N => {
    const size = vec3(wsize.x.add(1.6), max(2.7, wsize.y.add(1.0)), h.mul(2.5).add(3.0));
    const o = vec3(wp.x.add(0.8), wp.y.add(0.8), 0);
    const d = normalize(vec3(vt.x.negate(), vt.y.negate(), max(vt.z, 0.08)));
    const safe = mix(vec3(-1), vec3(1), step(0, d)).mul(max(abs(d), vec3(1e-5)));
    const tm = step(0, d).mul(size).sub(o).div(safe);
    const t = min(min(tm.x, tm.y), tm.z);
    const p = o.add(d.mul(t));
    const isBack = tm.z.lessThanEqual(min(tm.x, tm.y)), isY = tm.y.lessThan(min(tm.x, tm.z));
    const band = box(p.y, 0, fract(h.mul(7)).mul(0.5).add(0.85), 0.03).mul(box(p.x, size.x.mul(fract(h.mul(3))).mul(0.5), size.x.mul(fract(h.mul(5)).mul(0.5).add(0.5)), 0.03));
    const picture = box(p.y, 1.4, 1.95, 0.02).mul(box(p.x, 0.7, 1.5, 0.02)).mul(step(0.5, fract(h.mul(11))));
    const back = mix(mix(h.mul(0.18).add(0.42), 0.06, band), 0.2, picture);
    const tone = select(isBack, back, select(isY, select(d.y.greaterThan(0), float(0.8), float(0.1)), float(0.3)));
    const paint = mix(vec3(1, 0.93, 0.82), mix(vec3(0.76, 0.86, 0.8), vec3(0.95, 0.76, 0.7), fract(h.mul(13))), step(0.5, fract(h.mul(29))));
    const lamp = vec3(size.x.mul(mix(0.25, 0.75, h)), size.y.sub(0.1), size.z.mul(0.45));
    const light = exp(dot(p.sub(lamp), p.sub(lamp)).div(-4)).mul(1.4).add(0.2);
    return paint.mul(tone).mul(light);
  };

  const surface = Fn(() => {
    const seed = vData.x, style = vData.y, height = vData.z, street = vData.w;
    const bays = vWall.x;
    const uvm = vUv;
    const fw = max(fwidth(uvm), vec2(1e-4)).toVar();
    const world = positionWorld;
    const nW = normalize(normalWorld).toVar();
    const view = normalize(cameraPosition.sub(world)).toVar();
    const facing = clamp(dot(view, nW), 0, 1).toVar();
    const tangent = select(abs(nW.y).lessThan(0.9), normalize(vec3(0, 1, 0).cross(nW)), vec3(1, 0, 0));
    const vt = vec3(dot(view, tangent), view.y, dot(view, nW)).toVar();
    const isRoof = style.greaterThan(8);
    const glass = style.greaterThan(2.5).and(isRoof.not());
    const office = style.greaterThan(0.5).and(style.lessThan(1.5));
    const housing = glass.or(office).or(isRoof).not();

    // --- wall material: tone per building, tile or board joints, floor bands, grime ---
    const toneCol = wallTone(style).mul(mix(0.34, 0.62, fract(seed.mul(13.7))));
    const painted = style.greaterThan(1.5).and(style.lessThan(2.5));
    const paintIx = floor(fract(seed.mul(17.9)).mul(4));
    const paint = select(paintIx.lessThan(0.5), paints[0], select(paintIx.lessThan(1.5), paints[1], select(paintIx.lessThan(2.5), paints[2], paints[3]))).mul(0.5);
    const base = select(painted, paint, toneCol).toVar();
    const tile = select(housing, vec2(0.3, 0.15), vec2(1.2, 0.6));
    const jointW = select(housing, float(0.012), float(0.02));
    const joint = max(box(fract(uvm.x.div(tile.x)).mul(tile.x), 0, jointW, fw.x), box(fract(uvm.y.div(tile.y)).mul(tile.y), 0, jointW, fw.y));
    const jointFade = smoothstep(0.15, 0.6, max(fw.x.div(tile.x), fw.y.div(tile.y)));
    base.mulAssign(mix(joint.mul(0.4).oneMinus(), 0.93, jointFade));
    base.mulAssign(noise2(floor(uvm.div(tile)).add(seed.mul(91))).mul(0.16).add(0.92));
    const streak = noise2(vec2(uvm.x.mul(2.1).add(seed.mul(50)), uvm.y.mul(0.04))).mul(noise2(vec2(uvm.x.mul(0.7), uvm.y.mul(0.3).add(seed.mul(9)))));
    const grime = float(1).sub(smoothstep(0.15, 0.6, streak).mul(0.5)).sub(smoothstep(0, 12, world.y).oneMinus().mul(0.2));
    base.mulAssign(mix(1, grime, 0.7));
    const emit = vec3(0).toVar();
    const wallLight = vec3(0).toVar();
    pRough.assign(0.85);
    pMetal.assign(0);

    const inBays = step(0, uvm.x).mul(step(uvm.x, bays.mul(select(glass, float(BAY[3]), select(office, float(BAY[1]), float(BAY[0])))))).toVar();
    const shopZone = street.greaterThan(0.5).and(uvm.y.lessThan(PODIUM));

    If(isRoof, () => {
      base.assign(P('concrete_dark').mul(0.5).mul(noise2(uvm.mul(0.4).add(seed.mul(40))).mul(0.3).add(0.85)));
    }).ElseIf(shopZone, () => {
      // Shopfronts: a tenant per bay, glass with a lit room or a ribbed shutter.
      const len = vWall.y;
      const shops = max(1, floor(len.div(SHOP_BAY)));
      const u = uvm.x.add(len.sub(bays.mul(select(glass, float(BAY[3]), select(office, float(BAY[1]), float(BAY[0]))))).div(2)).sub(len.sub(shops.mul(SHOP_BAY)).div(2)).toVar();
      const sid = floor(u.div(SHOP_BAY)).toVar();
      const x = u.sub(sid.mul(SHOP_BAY)).toVar();
      const inShops = step(0, sid).mul(step(sid, shops.sub(0.5)));
      const s = seed.mul(31.7).toVar();
      const open = step(hash21(vec2(sid, s.add(1.3))), 0.62).mul(inShops).toVar();
      const hCol = hash21(vec2(sid, s.add(2.1)));
      const shopCol = select(hCol.lessThan(0.5), FLUOR, select(hCol.lessThan(0.85), TUNGSTEN, mix(FLUOR, TV, 0.5)));
      const pane = box(x, 0.3, SHOP_BAY - 0.3, fw.x).mul(box(uvm.y, 0.15, 3.1, fw.y)).mul(inShops).toVar();
      const ribs = mix(smoothstep(0.3, 0.7, abs(fract(uvm.y.mul(7)).sub(0.5)).mul(2)).mul(0.4).add(0.6), 0.8, smoothstep(0.035, 0.12, fw.y));
      const finish = hash21(vec2(sid, s.add(4.8)));
      const shutter = mix(select(finish.lessThan(0.4), METAL.mul(2.2), P('concrete')), base, 0.35).mul(ribs);
      const interior = room(vec2(x.sub(0.3), uvm.y.sub(0.15)), vec2(SHOP_BAY - 0.6, 2.95), vt, hash21(vec2(sid, s.add(8.2))));
      // Shelves of goods and a door frame, so the room is a shop and not a parlour.
      const shelves = box(fract(uvm.y.div(0.5)), 0.12, 0.88, fw.y.div(0.5)).mul(0.3).add(0.7).mul(noise2(vec2(x.mul(2.3).add(s), floor(uvm.y.div(0.5)).mul(3.1))).mul(0.35).add(0.75));
      const goods = mix(vec3(1), mix(TUNGSTEN, RED, hash21(vec2(floor(x.div(0.7)), sid.add(s)))), box(uvm.y, 0.6, 2.4, fw.y).mul(0.4));
      const doorX = select(finish.lessThan(0.5), float(1.4), float(SHOP_BAY - 1.5));
      const frame = max(box(x, doorX, doorX.add(0.09), fw.x), box(uvm.y, 2.45, 2.52, fw.y));
      base.assign(mix(base, select(open.greaterThan(0.5), GLASS, shutter), pane));
      base.assign(mix(base, METAL, frame.mul(pane)));
      emit.assign(pane.mul(open).mul(frame.oneMinus()).mul(shopCol).mul(goods).mul(interior.mul(shelves).mul(1.7).add(box(uvm.y, 2.9, 3.05, fw.y).mul(0.5))).mul(mix(0.7, 1.2, hash21(vec2(sid, s.add(7.2))))));
      pRough.assign(mix(0.85, select(open.greaterThan(0.5), float(0.15), float(0.55)), pane));
      pMetal.assign(open.oneMinus().mul(pane).mul(0.4));
    }).Else(() => {
      // --- windows ---
      const cell = select(glass, vec2(BAY[3], FLOOR_HEIGHT), select(office, vec2(BAY[1], FLOOR_HEIGHT), vec2(BAY[0], FLOOR_HEIGHT))).toVar();
      const vy = uvm.y.sub(select(street.greaterThan(0.5), float(PODIUM), float(1.3)));
      const cid = vec2(floor(uvm.x.div(cell.x)), floor(vy.div(cell.y))).toVar();
      const p = vec2(uvm.x.sub(cid.x.mul(cell.x)), vy.sub(cid.y.mul(cell.y))).toVar();
      const variant = floor(fract(seed.mul(73.1)).mul(3));
      const housingRect = select(variant.lessThan(0.5), vec4(0.8, 2.4, 0.95, 2.45), select(variant.lessThan(1.5), vec4(1.05, 2.15, 0.9, 2.5), vec4(0.6, 2.6, 1.15, 2.3)));
      const r = select(glass, vec4(0.06, BAY[3] - 0.06, 0.1, FLOOR_HEIGHT - 0.45), select(office, vec4(0.12, BAY[1] - 0.12, 0.95, 2.75), housingRect)).toVar();
      const present = inBays.mul(step(0, vy)).mul(step(uvm.y, height.sub(1.2))).toVar();
      const s = seed.mul(97.13).toVar();
      // Share of windows lit: homes one by one, offices by floor and tenant.
      const groupId = vec2(cid.y, floor(cid.x.div(7)));
      const floorOn = hash21(groupId.add(s).add(3.1));
      const ratio = select(glass, select(floorOn.lessThan(0.32), float(0), float(0.9)),
        select(office, select(floorOn.lessThan(0.45), float(0.04), float(0.55)), mix(0.28, 0.6, fract(seed.mul(7.31)))));
      const meanRatio = select(glass, float(0.61), select(office, float(0.32), mix(0.28, 0.6, fract(seed.mul(7.31)))));
      const lit = step(hash21(cid.add(s).add(17.7)), ratio).mul(present).toVar();
      const hInt = hash21(cid.add(s).add(2.9));
      const inten = select(glass, hash21(groupId.add(s).add(2.9)).mul(0.7).add(0.7), mix(0.5, 2.6, hInt.mul(hInt).mul(hInt))).toVar();
      const gh = hash21(groupId.add(s).add(8.3));
      const lightCol = select(glass.or(office), select(gh.lessThan(0.55), OFFICE, select(gh.lessThan(0.8), mix(OFFICE, TUNGSTEN, 0.7), mix(OFFICE, FLUOR, 0.8))), windowColor(hash21(cid.add(s).add(5.3)))).toVar();

      // Near: the room, behind curtains or blinds for some, in a recessed, framed opening.
      const wsize = r.yw.sub(r.xz);
      const q = p.sub(r.xz).div(wsize).toVar();
      const hRoom = hash21(cid.add(s).add(21));
      const cardRoom = room(p.sub(r.xz), wsize, vt, hRoom);
      const ceiling = mix(0.45, 1.8, smoothstep(0.62, 0.9, q.y));
      const officeRoom = vec3(0.3).mul(ceiling).mul(noise2(vec2(floor(uvm.x.div(0.6)), cid.y).add(s)).mul(0.3).add(0.85));
      const hCover = hash21(cid.add(s).add(9.1));
      const slat = mix(smoothstep(0.3, 0.7, fract(q.y.mul(12))).mul(0.7).add(0.3), 0.65, smoothstep(0.015, 0.05, fw.y));
      const covered = select(hCover.lessThan(0.2), step(mix(0.35, 1, fract(hCover.mul(5.6))).oneMinus(), q.y), float(0));
      const curtain = select(hCover.greaterThan(0.2).and(hCover.lessThan(0.34)), box(q.x, select(hCover.greaterThan(0.27), float(-0.1), float(0.5)), select(hCover.greaterThan(0.27), float(0.5), float(1.1)), 0.02), float(0));
      const homeInside = mix(mix(cardRoom.mul(0.9), vec3(0.55).mul(slat), covered), vec3(0.62, 0.57, 0.48).mul(0.5), curtain);
      const inside = lightCol.mul(select(housing, homeInside, officeRoom)).mul(mix(1, inten, 0.5));
      const mask = box(p.x, r.x, r.y, fw.x).mul(box(p.y, r.z, r.w, fw.y)).mul(present).toVar();
      const fwm = select(glass, float(0.035), float(0.06));
      const inner = box(p.x, r.x.add(fwm), r.y.sub(fwm), fw.x).mul(box(p.y, r.z.add(fwm), r.w.sub(fwm), fw.y));
      const mullion = select(glass, float(0), max(box(q.x, 0.485, 0.515, fw.x.div(wsize.x)), box(q.y, 0.63, 0.66, fw.y.div(wsize.y)).mul(select(housing, float(1), float(0)))));
      const frame = mask.mul(inner.mul(mullion.oneMinus()).oneMinus()).toVar();
      const around = present.mul(max(box(p.x, r.x.sub(0.14), r.y.add(0.14), fw.x).mul(box(p.y, r.z.sub(0.12), r.w.add(0.12), fw.y)).sub(mask), 0));
      const sill = present.mul(box(p.x, r.x.sub(0.12), r.y.add(0.12), fw.x)).mul(box(p.y, r.z.sub(0.16), r.z.sub(0.04), fw.y)).mul(select(housing, float(1), float(0)));
      const reflect = skyRefl(vt.y.negate().mul(0.5).add(0.25)).mul(pow(facing.oneMinus(), 4).mul(select(glass, float(0.85), float(0.5))).add(select(glass, float(0.14), float(0.04))));
      const dark = HAZE.mul(0.05).add(reflect);
      const near = mask.sub(frame).mul(mix(dark, inside.add(reflect.mul(0.4)), lit));

      // Mid and far.
      const fp = min(fw, cell.mul(2));
      const midMask = cover(p.x, r.x, r.y, fp.x).mul(cover(p.y, r.z, r.w, fp.y)).mul(present);
      const farGain = select(glass, float(0.5), float(1));
      const mid = midMask.mul(mix(dark, lightCol.mul(inten).mul(0.44).mul(farGain), lit));
      const winFrac = wsize.x.mul(wsize.y).div(cell.x.mul(cell.y)).mul(present);
      const meanLit = lightCol.mul(select(glass, inten, float(1.05))).mul(0.48).mul(farGain);
      const avg = winFrac.mul(mix(dark, meanLit, meanRatio));
      const px = max(fw.x.div(cell.x), fw.y.div(cell.y));
      const toMid = smoothstep(0.12, 0.3, px), toAvg = smoothstep(0.75, 1.5, px);
      const detail = toMid.oneMinus();
      const m = mix(mix(mask, midMask, toMid), winFrac, toAvg);

      If(glass, () => { base.assign(mix(METAL.mul(1.4), P('concrete_dark'), fract(seed.mul(3.3)).mul(0.4))); });
      // Floor slabs read as bands between rows of windows.
      base.mulAssign(box(fract(vy.div(cell.y)).mul(cell.y), 0, 0.3, fw.y).mul(0.3).mul(smoothstep(0.1, 0.3, fw.y.div(cell.y)).oneMinus()).mul(present).oneMinus());
      base.mulAssign(around.mul(detail).mul(0.5).oneMinus());
      base.assign(mix(base, base.mul(1.5), sill.mul(detail)));
      base.assign(mix(base, GLASS, m));
      base.assign(mix(base, METAL.mul(1.3), frame.mul(detail)));
      pRough.assign(mix(0.85, 0.12, m.mul(frame.oneMinus())));
      pMetal.assign(select(glass, m.mul(0.5), float(0)));
      emit.assign(mix(mix(near, mid, toMid), avg, toAvg));
      // Window light on its own reveal up close, and on the wall as an average further off.
      wallLight.addAssign(lightCol.mul(inten).mul(lit).mul(around).mul(0.35).mul(detail));
      wallLight.addAssign(lightCol.mul(winFrac).mul(meanRatio).mul(0.06));
    });

    // --- light from the street, never from light objects ---
    const lamp = lampTex.sample(mapUv(world.xz.add(nW.xz.mul(2.5)), inp.lampRect)).r;
    emit.addAssign(base.mul(SODIUM).mul(lamp).mul(1.6).mul(exp(max(world.y.sub(1), 0).div(-7))));
    const wideUv = mapUv(world.xz, inp.lampRect);
    const streetGlow = SODIUM.mul(lampTex.sample(wideUv).bias(4.5).r).mul(0.5).add(signTex.sample(wideUv).bias(4.5).rgb.mul(0.35));
    wallLight.addAssign(streetGlow.mul(0.3).mul(exp(max(world.y, 0).div(-20))).mul(select(isRoof, float(0.25), float(1))));
    wallLight.addAssign(mix(HAZE.mul(2.2), SODIUM.mul(0.25), 0.12).mul(0.25));
    wallLight.addAssign(skyRefl(float(0.05)).mul(pow(facing.oneMinus(), 3)).mul(nW.y.mul(0.5).add(1)).mul(0.35));
    const sign = signTex.sample(mapUv(world.xz.add(nW.xz.mul(1.5)), inp.lampRect)).rgb;
    emit.addAssign(base.mul(sign).mul(0.7).mul(exp(max(world.y.sub(14), 0).div(-8))).mul(smoothstep(0, 3, world.y)));
    emit.addAssign(base.mul(wallLight));
    emit.addAssign(base.mul(fixtureSpill(fixtureTex, mapUv(world.xz.add(nW.xz.mul(0.6)), inp.lampRect), world.y, nW.y, inp.fixtureHeights)));
    pEmit.assign(emit);
    return base;
  });

  const material = new THREE.MeshStandardNodeMaterial();
  material.name = 'facade';
  material.colorNode = surface();
  material.emissiveNode = pEmit;
  material.roughnessNode = pRough;
  material.metalnessNode = pMetal;
  return material;
}

/**
 * Material of the box kit: the instance colour as albedo, lit by the same street-light terms
 * as the facades, plus an emission pair per instance (strength, blink phase; 0 = steady).
 */
export function createBoxMaterial(inp: FacadeInputs): THREE.MeshStandardNodeMaterial {
  const flat = (node: N): N => varying(node).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.FIRST);
  const vFx = flat(attribute('aFx', 'vec2'));
  const vColor = instanceColor;   // three multiplies the albedo by it; the emission needs it too
  const lampTex = texture(inp.lampMap) as N, signTex = texture(inp.signMap) as N;
  const fixtureTex = texture(inp.fixtureMap) as N;
  const SODIUM = P('sodium'), HAZE = P('haze');
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.1 });
  material.name = 'boxes';
  material.emissiveNode = Fn(() => {
    const world = positionWorld;
    const nW = normalize(normalWorld);
    const uv = mapUv(world.xz.add(nW.xz.mul(1.2)), inp.lampRect);
    const lamp = lampTex.sample(uv).r;
    const street = SODIUM.mul(lamp.mul(lamp).mul(3).add(lampTex.sample(uv).bias(4).r.mul(0.25))).add(signTex.sample(uv).rgb.mul(1.2));
    const reach = exp(max(world.y.sub(1), 0).div(-9)).mul(nW.y.mul(0.35).add(0.65));
    const ambient = mix(HAZE.mul(2.2), SODIUM.mul(0.25), 0.12).mul(0.3);
    const blink = select(vFx.y.greaterThan(0.5), step(0.55, fract(inp.time.mul(0.8).add(vFx.y.mul(0.37)))), float(1));
    return vColor.mul(street.mul(reach).add(ambient).add(fixtureSpill(fixtureTex, mapUv(world.xz.add(nW.xz.mul(0.4)), inp.lampRect), world.y, nW.y, inp.fixtureHeights))).add(vColor.mul(vFx.x).mul(blink));
  })();
  return material;
}
