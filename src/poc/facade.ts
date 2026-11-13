import * as THREE from 'three/webgpu';
import {
  Fn, If, abs, attribute, cameraPosition, clamp, dFdx, dFdy, dot, exp, float, floor, fract, fwidth, int, length, max, min, mix, mod,
  normalWorld, normalize, positionWorld, pow, property, referenceAttribute, select, sin, smoothstep, step, texture, uniform, uniformArray, varying, vec2,
  vec3, vec4,
} from './tsl';
import facade from '../../art/style/facade.json';
import interiors from '../../art/textures/interiors/interiors.json';
import { SIGNAL } from '../../art/layouts/lib/traffic.mjs';
import { TOWER_BUNDLES } from '../materials/textures';
import { SCREEN_COLS, SCREEN_COUNT, SCREEN_ROWS } from '../scene/screens';
import { P, box, hash21, mapUv, noise2, paletteColor, type N, type PaletteName } from './tsl';

const T = facade.types;
const C = facade.cells;

export interface FacadeInputs {
  time: N;
  /** How late it is (src/scene/night.ts). */
  night: N;
  seed: number;
  lampMap: THREE.Texture;
  /** minX, minZ, 1/sizeX, 1/sizeZ of the lamp and sign maps (uniform vec4). */
  lampRect: N;
  signMap: THREE.Texture;
  towerDiffuse: THREE.DataArrayTexture;
  towerEmissive: THREE.DataArrayTexture;
  walls: THREE.Texture;
  /** Room cards behind lit windows and shopfronts (art/textures/interiors). */
  interiors: THREE.Texture;
  screens: THREE.Texture;
}

/**
 * The facade material as a node material. A deliberately reduced port of
 * src/materials/facade.ts, enough to judge the renderer, not a replacement:
 *   kept     surface types from COLOR_0, facade meters from TEXCOORD_0 with instance-scale
 *            compensation, wall materials, the photographic tower atlas with per-floor
 *            lighting, window grids with per-window light and distance averaging, storefronts,
 *            fixtures and signals, screens, car paint, lamp / sign / canyon light on walls;
 *            the interior-mapped room cards behind windows and shopfronts;
 *   dropped  window families and mullions, blinds and curtains, neighbour spill, the glass
 *            environment reflection, normal relief, car-park decks in detail.
 */
export function createFacadeMaterial(inp: FacadeInputs): THREE.MeshStandardNodeMaterial {
  // --- vertex stage: raw attributes (positionLocal / normalLocal are instance-transformed) ---
  const inst = referenceAttribute('instanceMatrix', 'mat4') as N;
  const nrm = attribute('normal', 'vec3') as N, uv0 = attribute('uv', 'vec2') as N, col0 = attribute('color', 'vec3') as N;
  const scale = vec3(
    length(inst.mul(vec4(1, 0, 0, 0)).xyz), length(inst.mul(vec4(0, 1, 0, 0)).xyz), length(inst.mul(vec4(0, 0, 1, 0)).xyz),
  );
  const origin = inst.mul(vec4(0, 0, 0, 1)).xyz;
  // u runs along local x on faces facing ±z, along local z on faces facing ±x; v runs up.
  const alongX = abs(nrm.z).greaterThanEqual(abs(nrm.x));
  const su = select(alongX, scale.x, scale.z);
  const sv = select(abs(nrm.y).greaterThan(0.7), select(alongX, scale.z, scale.x), scale.y);
  const flat = (node: N): N => varying(node).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.FIRST);
  const vFacadeUv = varying(vec2(uv0.x.mul(su), uv0.y.oneMinus().mul(sv))) as N;   // glTF stores 1 - v
  const vRawUv = varying(vec2(uv0.x, uv0.y.oneMinus())) as N;
  const vSurf = flat(col0);
  // The seed term is multiplied in the shader, in single precision like the GLSL material:
  // sin() of a large argument magnifies any rounding difference into a different building.
  const instSeed = fract(sin(dot(origin.xz, vec2(12.9898, 78.233)).add(uniform(inp.seed).mul(0.0137))).mul(43758.5453));
  const vSeed = flat(instSeed);
  // Moving cars carry their paint pick in a slight height scale, braking in their width and
  // signals their cycle in x / z scale (src/systems/vehicles.ts, src/systems/instancing.ts).
  const vPaint = flat(select(abs(scale.y.sub(1)).lessThan(1e-5), instSeed, clamp(scale.y.sub(1).mul(64), 0, 0.999)));
  const vBrake = flat(select(abs(scale.x.sub(1.004)).lessThan(0.001), float(1), float(0)));
  const vSignal = flat(vec2(clamp(scale.x.sub(1.01).div(0.02), 0, 1), step(1.005, scale.z)));

  const towerFacades = TOWER_BUNDLES.flatMap((b) => b.facades);
  const TF_RECT = uniformArray(towerFacades.map((t) => new THREE.Vector4(...t.rect)));
  const TF_DIM = uniformArray(towerFacades.map((t) => new THREE.Vector4(t.floor, t.bay, t.wrap[0], t.wrap[1])));
  const PAINT = uniformArray(['paint_mint', 'paint_salmon', 'paint_cream', 'paint_blue'].map((n) => paletteColor(n as PaletteName)));
  const CLAD = uniformArray(['clad_terracotta', 'clad_cream', 'clad_charcoal'].map((n) => paletteColor(n as PaletteName)));
  const CAR = uniformArray(['car_white', 'car_black', 'car_grey', 'car_silver', 'car_navy', 'car_red', 'car_green', 'car_beige',
    'car_yellow', 'car_orange', 'paint_mint', 'paint_blue'].map((n) => paletteColor(n as PaletteName)));
  const CAR_PICK = uniformArray([0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 7, 11, 10], 'int');

  const CONCRETE = P('concrete'), CONCRETE_DARK = P('concrete_dark'), METAL = P('metal_dark'), GLASS = P('glass_dark');
  const TUNGSTEN = P('tungsten'), FLUOR = P('fluorescent'), OFFICE_WHITE = P('office_white'), FOLIAGE = P('foliage');
  const TV = P('tv_blue'), SODIUM = P('sodium'), RED = P('sign_red'), HAZE = P('haze'), SKY = P('sky'), CYAN = P('sign_cyan');

  const lampTex = texture(inp.lampMap) as N, signTex = texture(inp.signMap) as N;

  // Room cards: room box (W, H, D, camera distance) and tile rects in texture UVs.
  const [IA_W, IA_H] = interiors.size;
  const SETS = interiors.sets;
  const tiles = (t: number[][]) => uniformArray(t.map(([x0, y0, x1, y1]) => new THREE.Vector4(x0 / IA_W, 1 - y1 / IA_H, x1 / IA_W, 1 - y0 / IA_H)));
  const boxOf = (b: { width: number; height: number; depth: number; camera: number }) => vec4(b.width, b.height, b.depth, b.camera);
  const pxPerM = (b: { width: number; tiles: number[][] }) => (b.tiles[0][2] - b.tiles[0][0]) / b.width;
  const RES_TILES = tiles(SETS.residential.tiles), OFF_TILES = tiles(SETS.office.tiles), SHOP_TILES = tiles(SETS.shops.tiles);
  const cardTex = texture(inp.interiors) as N;
  // Ray-cast the card's room box from the pane point `ro` along the tangent-space view `vt`,
  // then project the hit through the card camera into the tile: parallax from one image.
  const interior = (roomBox: N, tile: N, ro: N, vt: N, pxM: N, fw: N): N => {
    const size = roomBox.xyz;
    const o = vec3(clamp(ro, vec2(0.01), size.xy.sub(0.01)), 0);
    const d = normalize(vec3(vt.x.negate(), vt.y.negate(), max(vt.z, 0.08)));
    const safeD = mix(vec3(-1), vec3(1), step(0, d)).mul(max(abs(d), vec3(0.00001)));
    const tm = step(0, d).mul(size).sub(o).div(safeD);
    const h = o.add(d.mul(max(min(min(tm.x, tm.y), tm.z), 0)));
    const c = size.xy.mul(0.5);
    const k = roomBox.w.div(roomBox.w.add(h.z));   // card size of a meter at the hit's depth
    const q = clamp(c.add(h.xy.sub(c).mul(k)).div(size.xy), 0.002, 0.998);
    const lod = max(max(fw.x, fw.y).mul(pxM).mul(k), 1).log2();
    return cardTex.sample(mix(tile.xy, tile.zw, q)).level(lod).rgb;
  };

  // Opening pattern of a window face (lib/surface.py window_code): which cell columns have a
  // window. Codes: 0 blank, 63 all, 62 even, 61 odd, else a bit mask of columns 0..5.
  const openCol = (g: N, column: N): N => {
    const code = floor(g.mul(64));
    const bit = mod(floor(code.div(pow(2, clamp(column, 0, 5)))), 2);
    const masked = select(column.greaterThan(5), float(0), bit);
    const v = select(code.greaterThanEqual(63), float(1),
      select(code.equal(62), mod(column, 2).oneMinus(), select(code.equal(61), mod(column, 2), masked)));
    return select(column.lessThan(0), float(0), v);
  };
  const openFrac = (g: N): N => {
    const code = floor(g.mul(64));
    let n: N = float(0), hi: N = float(0);
    for (let i = 0; i < 6; i++) {
      const b = mod(floor(code.div(2 ** i)), 2);
      n = n.add(b);
      hi = max(hi, b.mul(i));
    }
    return select(code.greaterThanEqual(63), float(1), select(code.greaterThanEqual(61), float(0.5), n.div(hi.add(2))));
  };
  const windowColor = (h: N): N => select(h.lessThan(0.85), mix(TUNGSTEN, FLUOR, h.div(0.85).mul(0.26).add(0.12)),
    select(h.lessThan(0.98), mix(FLUOR, TUNGSTEN, 0.35), mix(TV, FLUOR, 0.55)));
  const skyRefl = (y: N): N => mix(HAZE.mul(1.6).add(SODIUM.mul(0.03)), SKY, smoothstep(0, 0.5, max(y, 0)));

  const pEmit = property('vec3') as N, pRough = property('float') as N, pMetal = property('float') as N;

  const surface = Fn(() => {
    const typeRaw = int(vSurf.x.mul(16)).toVar();
    const towerRes = typeRaw.equal(T.tower_res), glassSkin = typeRaw.equal(T.glass);
    const type = select(towerRes, int(T.residential), select(glassSkin, int(T.curtain), typeRaw)).toVar();
    const isType = (...ids: number[]): N => ids.map((id) => type.equal(id) as N).reduce((a, b) => a.or(b));
    const fill = vSurf.y, tint = vSurf.z;
    const uvm = vFacadeUv;
    const fw = max(fwidth(uvm), vec2(1e-4)).toVar();
    const seed = vSeed;
    const world = positionWorld;
    const nW = normalize(normalWorld).toVar();
    const view = normalize(cameraPosition.sub(world)).toVar();
    const facing = clamp(dot(view, nW), 0, 1).toVar();
    // Tangent-space view vector (x along the wall, y up, z out), for the room cards.
    const tangent = select(abs(nW.y).lessThan(0.9), normalize(vec3(0, 1, 0).cross(nW)), vec3(1, 0, 0)).toVar();
    const bitangent = normalize(nW.cross(tangent));
    const vt = vec3(dot(view, tangent), dot(view, bitangent), dot(view, nW)).toVar();

    // Wall material per building (4x2 atlas), mirror-repeated in facade meters.
    const pick = fract(seed.mul(23.71));
    const mat = select(type.equal(T.office),
      select(pick.lessThan(0.3), float(7), select(pick.lessThan(0.55), float(5), select(pick.lessThan(0.75), float(6), float(1)))),
      select(type.equal(T.roof), select(pick.lessThan(0.5), float(3), float(4)),
        select(pick.lessThan(0.38), float(0), select(pick.lessThan(0.58), float(1), select(pick.lessThan(0.74), float(4), select(pick.lessThan(0.88), float(3), float(5)))))));
    const matSize = select(mat.equal(0), float(2.4), select(mat.equal(5), float(3.2), select(mat.equal(2).or(mat.equal(6)), float(2.0), float(3.0))));
    const wallCell = vec2(mod(mat, 4).mul(0.25), floor(mat.div(4)).add(1).mul(0.5).oneMinus());
    const wl = uvm.add(vec2(seed.mul(37), 0)).div(matSize);
    const wk = vec2(0.25, 0.5).mul(0.99);
    const wallUv = wallCell.add(vec2(0.00125, 0.0025)).add(abs(fract(wl.mul(0.5)).mul(2).sub(1)).mul(wk));
    const wall = (texture(inp.walls, wallUv) as N).grad(dFdx(wl).mul(wk), dFdy(wl).mul(wk)).toVar();

    const tintShift = fract(seed.mul(5.3)).sub(0.5);
    const tintCol = vec3(tintShift.mul(0.1).add(1), 1, tintShift.mul(-0.12).add(1));
    const base = wall.rgb.mul(tintCol).mul(mix(0.3, 0.6, tint)).mul(fract(seed.mul(13.7)).mul(0.35).add(0.75)).toVar();
    const streak = noise2(vec2(uvm.x.mul(2.1).add(seed.mul(50)), uvm.y.mul(0.04))).mul(noise2(vec2(uvm.x.mul(0.7), uvm.y.mul(0.3).add(seed.mul(9)))));
    const grime = float(1).sub(smoothstep(0.15, 0.6, streak).mul(0.55)).sub(smoothstep(0, 12, world.y).oneMinus().mul(0.2)).toVar();
    const wallLum = dot(wall.rgb, vec3(0.5)).mul(2);
    const k17 = fract(seed.mul(17.9));
    If(towerRes.and(k17.lessThan(0.75)), () => {
      base.assign(mix(base, CLAD.element(int(k17.div(0.25))).mul(mix(0.45, 0.75, tint)).mul(wallLum), 0.85));
    }).ElseIf(towerRes.not().and(isType(T.residential, T.cage, T.trim)).and(fract(seed.mul(41.3)).lessThan(0.45)), () => {
      base.assign(mix(base, PAINT.element(int(k17.mul(4))).mul(mix(0.45, 0.75, tint)).mul(wallLum), 0.8));
    });
    base.mulAssign(mix(1, grime, 0.65));

    const emit = vec3(0).toVar();
    const wallLight = vec3(0).toVar();
    const rough = mix(0.75, 0.97, wall.a).toVar();
    const metal = select(mat.equal(2).or(mat.equal(6)), float(0.35), float(0)).toVar();

    // Derivatives for samples taken inside branches, computed in uniform control flow.
    const perMBase = float(1 / C.curtain.h);
    const uvmDx = dFdx(uvm).toVar(), uvmDy = dFdy(uvm).toVar();
    const rawFw = fwidth(vRawUv).toVar();

    If(type.equal(T.atlas), () => {
      // Photographic tower facade: bundle and facade per building, offset by whole bays/floors.
      const bundle = int(fract(seed.mul(3.17)).mul(3)).toVar();
      const fi = bundle.mul(7).add(int(fract(seed.mul(11.3)).mul(7))).toVar();
      const R = TF_RECT.element(fi), Dm = TF_DIM.element(fi);
      const perM = Dm.x.mul(perMBase).toVar();
      const L = uvm.mul(perM).add(vec2(floor(fract(seed.mul(5.1)).mul(9)).mul(Dm.y), floor(fract(seed.mul(7.9)).mul(9)).mul(Dm.x))).toVar();
      const Lw = mod(L, Dm.zw);
      const auv = vec2(R.x.add(Lw.x), R.w.oneMinus().add(Lw.y));
      const gx = uvmDx.mul(perM), gy = uvmDy.mul(perM);
      const dr = (texture(inp.towerDiffuse, auv) as N).depth(bundle).grad(gx, gy).toVar();
      const em = (texture(inp.towerEmissive, auv) as N).depth(bundle).grad(gx, gy).rgb.toVar();
      base.assign(dr.rgb.mul(0.5));
      rough.assign(clamp(dr.a, 0.12, 0.95));
      metal.assign(dr.a.oneMinus().mul(0.4));
      // Not every floor is occupied; tenants light runs of floors; later at night more go dark.
      const floorId = floor(L.y.div(Dm.x)).toVar();
      const floorLit = mix(0.35, 1.2, hash21(vec2(floorId, seed.mul(31)))).mul(step(inp.night.mul(0.4).add(0.33), hash21(vec2(floorId, seed.mul(13).add(2))))).toVar();
      const bayId = floor(L.x.div(Dm.y));
      const bayM = max(Dm.y.div(perM), 0.1), floorM = max(Dm.x.div(perM), 0.1);
      const bayVar = mix(mix(0.68, 1.18, hash21(vec2(bayId, seed.mul(23).add(7)))), 0.95, smoothstep(0.25, 0.7, fw.x.div(bayM)));
      const groupSize = mix(4, 9, fract(seed.mul(9.7).add(0.31)));
      const groupOn = step(0.22, hash21(vec2(floor(floorId.div(groupSize)), seed.mul(43).add(7))));
      floorLit.mulAssign(mix(mix(0.12, 1, groupOn), 0.78, smoothstep(0.35, 0.9, fw.y.div(floorM))));
      emit.assign(em.mul(2.1).mul(floorLit).mul(bayVar));
      // Unlit glass picks up the sky glow at grazing angles (the full shader reflects the city).
      const glassAmt = smoothstep(0.3, 0.6, dr.a).oneMinus();
      emit.addAssign(skyRefl(float(0.1)).mul(glassAmt).mul(pow(facing.oneMinus(), 4).mul(0.82).add(0.18)).mul(0.6));
      wallLight.addAssign(em.mul(floorLit).mul(0.25));
    }).ElseIf(isType(T.residential, T.office, T.curtain, T.cage), () => {
      const cage = type.equal(T.cage);
      const office = type.equal(T.office), curtain = type.equal(T.curtain);
      const cell = select(office, vec2(C.office.w, C.office.h), select(curtain, vec2(C.curtain.w, C.curtain.h), vec2(C.residential.w, C.residential.h))).toVar();
      const cid = floor(uvm.div(cell)).toVar();
      const p = uvm.sub(cid.mul(cell)).toVar();
      const r = select(office, vec4(0.08, C.office.w - 0.08, 0.95, 2.95),
        select(curtain, vec4(0.05, C.curtain.w - 0.05, 0.12, C.curtain.h - 0.28), vec4(0.8, 2.4, 0.9, 2.45))).toVar();
      const winFill = select(cage, float(63.5 / 64), fill);
      const present = openCol(winFill, cid.x).toVar();
      const s = seed.mul(97.13).toVar();
      const range = select(towerRes, vec2(0.48, 0.68), select(glassSkin, vec2(0.85, 0.97), vec2(0.25, 0.55)));
      const litRatio = mix(range.x, range.y, fract(seed.mul(7.31))).mul(mix(1, 0.55, inp.night)).toVar();
      const baseRatio = float(litRatio).toVar();
      const darkFloors = select(glassSkin, float(0.3), float(0.45));
      If(office.or(curtain), () => {
        litRatio.mulAssign(select(curtain, select(glassSkin, float(1), float(0.3)), float(0.5)));
        baseRatio.assign(litRatio.mul(select(glassSkin, darkFloors.oneMinus(), float(1))));
        const floorOn = hash21(vec2(cid.y, floor(cid.x.div(7)).add(s).add(3.1)));
        litRatio.mulAssign(select(floorOn.lessThan(darkFloors), float(0), select(floorOn.greaterThan(0.9), float(3), float(1))));
      });
      const lit = step(hash21(cid.add(s).add(17.7)), litRatio).mul(present).toVar();
      const hInt = hash21(cid.add(s).add(2.9));
      const groupId = vec2(cid.y, floor(cid.x.div(7)));
      const inten = select(glassSkin, hash21(groupId.add(s).add(2.9)).mul(0.8).add(0.75), mix(0.45, 3.0, hInt.mul(hInt).mul(hInt))).toVar();
      const gh = hash21(groupId.add(s).add(8.3));
      const glassCol = select(gh.lessThan(0.45), OFFICE_WHITE, select(gh.lessThan(0.7), mix(OFFICE_WHITE, TUNGSTEN, 0.8),
        select(gh.lessThan(0.85), mix(OFFICE_WHITE, FLUOR, 0.85), OFFICE_WHITE.mul(0.4))));
      const lightCol = select(glassSkin, glassCol, windowColor(hash21(cid.add(s).add(5.3)))).toVar();
      // Lit windows show a room card. Homes: one room per cell. Offices and glass: four cells
      // share one wide room, so neighbouring panes look into different parts of the same floor.
      const q = p.sub(r.xz).div(r.yw.sub(r.xz)).toVar();
      const res = office.or(curtain).not();
      const g4 = floor(cid.x.div(4));
      const offX = cid.x.sub(g4.mul(4)).mul(cell.x).add(p.x).mul(SETS.office.width).div(cell.x.mul(4));
      const cardRo = select(res, vec2(p.x.sub(r.x.add(r.y).mul(0.5).sub(SETS.residential.width / 2)), p.y.sub(0.15)), vec2(offX, p.y.sub(0.2)));
      const resTile = RES_TILES.element(int(hash21(cid.add(s).add(21)).mul(SETS.residential.tiles.length)));
      const offTile = OFF_TILES.element(int(hash21(vec2(g4, cid.y).add(s).add(21)).mul(SETS.office.tiles.length)));
      const cardPx = select(res, float(pxPerM(SETS.residential)), cell.x.mul(4 * pxPerM(SETS.office) / SETS.office.width));
      const card = interior(select(res, boxOf(SETS.residential), boxOf(SETS.office)), select(res, resTile, offTile), cardRo, vt, cardPx, fw);
      const cardLit = lightCol.mul(card).mul(0.85).mul(mix(1, inten, 0.5));
      // Glass skins: once the card blurs, a bright ceiling band over darker desks takes over.
      const ceiling = mix(0.5, 1.9, smoothstep(0.66, 0.88, q.y));
      const floorLit = lightCol.mul(0.34).mul(ceiling).mul(mix(1, inten, 0.5));
      const inside = select(glassSkin, mix(cardLit, floorLit, smoothstep(0.04, 0.15, max(fw.x.div(cell.x), fw.y.div(cell.y)))), cardLit);
      const mask = box(p.x, r.x, r.y, fw.x).mul(box(p.y, r.z, r.w, fw.y)).mul(present).toVar();
      const inner = box(p.x, r.x.add(0.05), r.y.sub(0.05), fw.x).mul(box(p.y, r.z.add(0.05), r.w.sub(0.05), fw.y));
      const frame = mask.mul(inner.oneMinus()).toVar();
      const around = present.mul(max(box(p.x, r.x.sub(0.14), r.y.add(0.14), fw.x).mul(box(p.y, r.z.sub(0.1), r.w.add(0.12), fw.y)).sub(mask), 0));
      const dark = HAZE.mul(0.05).add(skyRefl(float(0.2)).mul(pow(facing.oneMinus(), 4).mul(0.5).add(0.04)));
      const near = mask.sub(frame).mul(mix(dark, inside, lit));
      // Three distance tiers, as in the GLSL material: the room card up close; then one flat
      // light per window, weighted by how much of the pixel the opening covers (so small
      // windows keep their energy and stay distinct dots); then the facade's mean light.
      const cover = (x: N, lo: N, hi: N, footprint: N): N => clamp(min(x.add(footprint.mul(0.5)), hi).sub(max(x.sub(footprint.mul(0.5)), lo)).div(footprint), 0, 1);
      const midMask = cover(p.x, r.x, r.y, min(fw.x, cell.x.mul(2))).mul(cover(p.y, r.z, r.w, min(fw.y, cell.y.mul(2)))).mul(present);
      const glassFar = select(glassSkin, float(0.5), float(1));
      const mid = midMask.mul(mix(dark, lightCol.mul(inten).mul(0.44).mul(glassFar), lit));
      const winFrac = r.y.sub(r.x).mul(r.w.sub(r.z)).div(cell.x.mul(cell.y));
      const frac = winFrac.mul(openFrac(winFill));
      const meanLit = select(glassSkin, glassCol.mul(inten), windowColor(float(0.5))).mul(0.48);
      const ratio = min(baseRatio, 1);
      const avg = frac.mul(meanLit.mul(ratio).mul(select(res, float(1), float(0.85))).mul(glassFar).add(dark.mul(ratio.oneMinus())));
      const px = max(fw.x.div(cell.x), fw.y.div(cell.y));
      const toMid = smoothstep(0.12, 0.3, px);
      const toAvg = smoothstep(0.75, 1.5, px).toVar();
      const detail = toMid.oneMinus();
      const m = mix(mix(mask, midMask, toMid), frac, toAvg);
      If(curtain, () => { base.assign(mix(METAL, CONCRETE_DARK, tint.mul(0.3))); });
      base.mulAssign(around.mul(detail).mul(0.45).oneMinus());
      base.assign(mix(base, GLASS, m));
      base.assign(mix(base, METAL.mul(1.3), frame.mul(detail)));
      rough.assign(mix(rough, 0.15, m.mul(frame.oneMinus())));
      emit.assign(mix(mix(near, mid, toMid), avg, toAvg));
      wallLight.addAssign(lightCol.mul(inten).mul(lit).mul(around).mul(0.3).mul(toAvg.oneMinus()));
      wallLight.addAssign(windowColor(float(0.5)).mul(openFrac(winFill)).mul(min(litRatio, 1)).mul(0.033));
      If(cage, () => {
        const bars = mix(max(box(fract(uvm.x.div(0.12)), 0.15, 0.85, fw.x.div(0.12)).oneMinus(), box(fract(uvm.y.div(0.4)), 0.06, 0.94, fw.y.div(0.4)).oneMinus()),
          0.45, smoothstep(0.04, 0.16, max(fw.x.div(0.12), fw.y.div(0.4))));
        base.assign(mix(base.mul(0.6), METAL.mul(1.4), bars));
        emit.mulAssign(bars.oneMinus().mul(0.8));
        metal.assign(bars.mul(0.4));
      });
    }).ElseIf(type.equal(T.podium), () => {
      // Storefronts: one tenant per 4.8 m bay; open shops glow, closed ones show a shutter.
      const W = C.podium.w;
      const sid = floor(uvm.x.div(W)).toVar();
      const x = uvm.x.sub(sid.mul(W)).toVar();
      const s = seed.mul(31.7).toVar();
      const present = step(hash21(vec2(sid, s)), fill);
      const shopCard = min(int(hash21(vec2(sid, s.add(8.2))).mul(SETS.shops.tiles.length)), int(SETS.shops.tiles.length - 1)).toVar();
      const kind = shopCard.mod(3);
      const openShare = select(kind.equal(0), float(0.9), select(kind.equal(1), float(0.65), float(0.3)).mul(mix(1, 0.5, inp.night)));
      const open = step(hash21(vec2(sid, s.add(1.3))), openShare).mul(present).toVar();
      const hCol = hash21(vec2(sid, s.add(2.1)));
      const shopCol = select(hCol.lessThan(0.5), FLUOR, select(hCol.lessThan(0.85), TUNGSTEN, mix(FLUOR, TV, 0.5)));
      const pier = box(x, 0.3, W - 0.3, fw.x).oneMinus();
      const glassMask = box(uvm.y, 0.15, 3.25, fw.y).mul(pier.oneMinus()).mul(present).toVar();
      const stock = mix(0.45, 1, smoothstep(0.3, 2.2, uvm.y)).mul(noise2(vec2(x.mul(1.5).add(s), uvm.y.mul(0.8))).mul(0.2).add(0.8));
      const strip = box(uvm.y, 2.95, 3.1, fw.y).mul(1.6);
      const goods = mix(vec3(1), mix(TUNGSTEN, RED, hash21(vec2(floor(x.div(0.7)), sid.add(s)))), box(uvm.y, 1.2, 2.6, fw.y).mul(0.35));
      const ribs = mix(smoothstep(0.3, 0.7, abs(fract(uvm.y.mul(7)).sub(0.5)).mul(2)).mul(0.4).add(0.6), 0.8, smoothstep(0.035, 0.12, fw.y));
      const finish = hash21(vec2(sid, s.add(4.8)));
      const shutterPaint = select(finish.lessThan(0.3), METAL.mul(2.2), select(finish.lessThan(0.65), CONCRETE, PAINT.element(int(finish.mul(4)))));
      const shutter = mix(shutterPaint, base, 0.35).mul(ribs).mul(mix(0.6, 1, grime));
      base.assign(mix(base, select(open.greaterThan(0.5), GLASS, shutter), glassMask));
      const shopRoom = interior(boxOf(SETS.shops), SHOP_TILES.element(shopCard), vec2(x.sub(0.3), uvm.y.sub(0.15)), vt, float(pxPerM(SETS.shops)), fw).mul(mix(vec3(1), shopCol.mul(goods), 0.4));
      const doorX = select(finish.lessThan(0.5), float(1.55), float(W - 1.55));
      const transom = mix(2.35, 2.8, hash21(vec2(sid, s.add(5.1))));
      const shopFrame = max(max(box(x, doorX, doorX.add(0.1), fw.x), box(uvm.y, transom, transom.add(0.08), fw.y)), box(x, 2.35, 2.43, fw.x).mul(step(0.82, finish)));
      base.assign(mix(base, METAL, shopFrame.mul(glassMask)));
      emit.assign(glassMask.mul(open).mul(shopRoom.mul(stock.add(1.5)).add(shopCol.mul(strip).mul(0.25))).mul(shopFrame.oneMinus())
        .mul(mix(0.6, 1.15, hash21(vec2(sid, s.add(7.2))))));
      base.mulAssign(box(uvm.y, 3.35, 4.5, fw.y).mul(0.4).oneMinus());
      rough.assign(mix(rough, select(open.greaterThan(0.5), float(0.2), float(0.6)), glassMask));
      metal.assign(open.oneMinus().mul(glassMask).mul(0.4));
    }).ElseIf(type.equal(T.roof), () => {
      base.mulAssign(0.7);
    }).ElseIf(type.equal(T.foliage), () => {
      const leaf = noise2(world.xz.mul(1.7).add(world.y.mul(0.9))).mul(noise2(world.xz.mul(0.45).add(seed.mul(7))));
      base.assign(FOLIAGE.mul(mix(0.55, 1.35, leaf)).mul(mix(0.8, 1.2, fract(seed.mul(19.3)))).mul(mix(0.8, 1.2, tint)));
      rough.assign(0.95);
    }).ElseIf(type.equal(T.metal), () => {
      base.assign(METAL.mul(mix(0.7, 1.6, noise2(uvm.mul(2).add(seed.mul(9))))));
      rough.assign(0.55);
      metal.assign(0.5);
      // Vehicle subtypes use the metal fill channel: paint, glass, tyres.
      If(fill.greaterThan(0.15).and(fill.lessThan(0.35)), () => {
        const pickIndex = select(fill.lessThan(0.25), CAR_PICK.element(min(int(vPaint.mul(16)), int(15))), min(int(tint.mul(12)), int(11)));
        base.assign(CAR.element(pickIndex).mul(mix(0.65, 0.9, smoothstep(0.2, 0.7, uvm.y))));
        rough.assign(0.32);
        metal.assign(0.25);
      }).ElseIf(fill.greaterThan(0.35).and(fill.lessThan(0.65)), () => {
        base.assign(GLASS); rough.assign(0.12); metal.assign(0.65);
      }).ElseIf(fill.greaterThan(0.65), () => {
        base.assign(METAL.mul(0.25)); rough.assign(0.95); metal.assign(0);
      });
    }).ElseIf(type.equal(T.soffit), () => {
      const tubes = box(fract(uvm.y.div(1.1)), 0.46, 0.54, fw.y.div(1.1)).mul(box(fract(uvm.x.div(1.8)), 0.08, 0.92, fw.x.div(1.8)))
        .mul(step(0.25, hash21(vec2(floor(uvm.x.div(1.8)), seed.mul(11)))));
      base.assign(CONCRETE_DARK);
      const tenant = hash21(vec2(floor(uvm.x.div(C.podium.w)), seed.mul(31.7).add(6)));
      emit.assign(select(tenant.lessThan(0.35), TUNGSTEN, FLUOR).mul(tubes.mul(mix(0.3, 1.3, tenant)).mul(step(0.18, tenant)).add(0.015)));
    }).ElseIf(type.equal(T.screen), () => {
      // Video screen: cycle through the poster atlas, cross-fading, with an LED grid up close.
      const sp = vRawUv;
      const sid = fill.mul(17).add(tint.mul(5)).add(seed.mul(3)).toVar();
      const cyc = inp.time.div(7).add(sid).toVar();
      const clip = floor(cyc), ct = fract(cyc);
      const zoom = sp.sub(0.5).div(ct.mul(0.06).add(1)).add(0.5);
      const slot = vec2(1 / SCREEN_COLS, 1 / SCREEN_ROWS);
      const pad = slot.mul(vec2(0.01, 0.005));
      const slotUv = (i: N): N => vec2(mod(i, SCREEN_COLS), float(SCREEN_ROWS - 1).sub(floor(i.div(SCREEN_COLS)))).mul(slot).add(pad).add(zoom.mul(slot.sub(pad.mul(2))));
      const ia = floor(hash21(vec2(clip, sid)).mul(SCREEN_COUNT)), ib = floor(hash21(vec2(clip.sub(1), sid)).mul(SCREEN_COUNT));
      const sdx = dFdx(sp).mul(slot), sdy = dFdy(sp).mul(slot);
      const sample = (i: N): N => (texture(inp.screens, slotUv(i)) as N).grad(sdx, sdy).rgb;
      const img = mix(sample(ib), sample(ia), smoothstep(0, 0.06, ct)).mul(sin(sp.y.mul(180).sub(inp.time.mul(6))).mul(0.08).add(0.92));
      const led = fract(sp.mul(vec2(160, 240)));
      const px = max(rawFw.x.mul(160), rawFw.y.mul(240));
      const dots = mix(box(led.x, 0.15, 0.85, 0.05).mul(box(led.y, 0.15, 0.85, 0.05)), 0.5, smoothstep(0.3, 0.8, px));
      base.assign(METAL);
      emit.assign(img.mul(dots).mul(1.9));
      rough.assign(0.3);
    }).ElseIf(type.equal(T.deck), () => {
      // Car-park deck: dim concrete under ceiling tubes (the full shader draws the parked cars).
      const dh = fill.mul(8), band = tint.mul(4);
      const h = mod(uvm.y, dh).sub(band), roomH = dh.sub(band);
      const tubes = box(h, roomH.sub(0.12), roomH.sub(0.04), fw.y).mul(box(fract(uvm.x.div(3)), 0.1, 0.7, fw.x.div(3)));
      const far = smoothstep(0.05, 0.2, max(fw.x, fw.y));
      base.assign(mix(CONCRETE.mul(0.6), CONCRETE_DARK.mul(0.5), box(fract(uvm.x.div(5.4)).mul(5.4), 0, 0.5, fw.x)));
      emit.assign(mix(FLUOR.mul(smoothstep(0, roomH, h).mul(0.75).add(0.25).mul(0.035).add(tubes.mul(1.6))), FLUOR.mul(0.09), far));
      rough.assign(0.85);
    }).ElseIf(type.equal(T.fixture), () => {
      // fixture_colors in facade.json: sodium 0, white 0.25, cyan 0.5, blue 0.75, red 1.
      const fc = select(fill.lessThan(0.125), SODIUM, select(fill.lessThan(0.375), FLUOR, select(fill.lessThan(0.625), CYAN, select(fill.lessThan(0.875), TV, RED)))).toVar();
      const blink = select(fill.greaterThan(0.875), step(0.5, fract(inp.time.mul(0.9).add(seed.mul(3)))), float(1));
      base.assign(fc.mul(0.2));
      const strip = tint.greaterThan(0.9);
      const lamp = tint.greaterThan(0.15).and(tint.lessThan(0.5));
      const brake = select(lamp.and(fill.greaterThan(0.875)), vBrake.mul(1.6).add(1), float(1));
      const power = select(strip, float(0.65), select(lamp, float(2.4), float(4)));
      emit.assign(select(strip, mix(fc, vec3(1), 0.35), fc).mul(power).mul(blink).mul(brake));
      If(tint.greaterThan(0.6).and(tint.lessThanEqual(0.9)), () => {
        // Traffic-signal lens: the same cycle as signalAt() in art/layouts/lib/traffic.mjs.
        const st = mod(inp.time.add(vSignal.x.mul(SIGNAL.period)), SIGNAL.period).sub(vSignal.y.mul(SIGNAL.green + SIGNAL.amber)).toVar();
        const green = step(0, st).mul(step(st, SIGNAL.green - 1e-3));
        const amber = step(SIGNAL.green, st).mul(step(st, SIGNAL.green + SIGNAL.amber - 1e-3));
        const on = select(fill.lessThan(0.125), amber, select(fill.lessThan(0.625), green, green.add(amber).oneMinus()));
        const lens = select(fill.lessThan(0.125), vec3(1, 0.55, 0.08), select(fill.lessThan(0.625), vec3(0.15, 1, 0.55), vec3(1, 0.08, 0.05)));
        base.assign(lens.mul(0.05));
        emit.assign(lens.mul(mix(0.04, 5, on)));
      });
    });

    // Light arriving from the street: lamp pools up the lower floors, a wide canyon glow,
    // coloured sign spill, a faint city bounce and a sky rim on grazing faces.
    const lampUv = mapUv(world.xz.add(nW.xz.mul(2.5)), inp.lampRect);
    const wideUv = mapUv(world.xz, inp.lampRect);
    const lamp = lampTex.sample(lampUv).r;
    emit.addAssign(base.mul(SODIUM).mul(lamp).mul(1.5).mul(exp(max(world.y.sub(1), 0).div(-7))));
    const street = SODIUM.mul(lampTex.sample(wideUv).bias(4.5).r).mul(0.5).add(signTex.sample(wideUv).bias(4.5).rgb.mul(0.35));
    wallLight.addAssign(street.mul(0.28).mul(exp(max(world.y, 0).div(-20))).mul(select(type.equal(T.roof), float(0.25), float(1))));
    wallLight.addAssign(mix(HAZE.mul(2.2), SODIUM.mul(0.25), 0.12).mul(0.25));
    const rim = pow(facing.oneMinus(), 3).mul(nW.y.mul(0.5).add(1));
    wallLight.addAssign(skyRefl(float(0.05)).mul(rim).mul(0.35).add(HAZE.mul(0.05)));
    const sign = signTex.sample(mapUv(world.xz.add(nW.xz.mul(1.5)), inp.lampRect)).rgb;
    emit.addAssign(base.mul(sign).mul(0.6).mul(exp(max(world.y.sub(14), 0).div(-8))).mul(smoothstep(0, 3, world.y)));
    const selfLit = isType(T.fixture, T.screen);
    emit.addAssign(select(selfLit, vec3(0), base.mul(wallLight)));
    // One evaluation feeds all four material inputs: colour is built first and returns the
    // albedo; emissive, roughness and metalness read the properties written here.
    pEmit.assign(emit);
    pRough.assign(rough);
    pMetal.assign(metal);
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
