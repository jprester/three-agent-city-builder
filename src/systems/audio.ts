import * as THREE from 'three';
import { lightningAt } from '../scene/lightning';
import type { Layout } from './layout';

/**
 * City sound with the Web Audio API, all of it recorded (public/audio/, from art/external/audio via
 * `npm run audio`; the author's ElevenLabs ambience and generated effects), driven by the scene:
 *  - ambience: two 30 s night-city recordings, alternated with equal-power crossfades so neither
 *    clip's loop point is heard; a little quieter from the air;
 *  - rain: a seamless loop following the rain waves, mostly at street level;
 *  - tyre hiss: a seamless loop whose level and pan follow the nearest simulated cars on the
 *    wet road, so each close pass swooshes by;
 *  - thunder: a near or far roll a few seconds after each lightning flash (src/scene/lightning.ts),
 *    the near one for short delays, louder the shorter the delay;
 *  - nightlife: where street-level shop signs crowd together (the hero avenue most of all), a
 *    crowd murmur and soft futuristic tones swell; around a dozen venues picked from the densest
 *    sign clusters play muffled club, bar or arcade sound, louder as you pass and panned toward
 *    them (clubs and bars mostly quiet by day). All of it fades out with height.
 * Browsers only start audio after a user gesture, so it begins muted; `toggle()` (button, M key)
 * turns it on and loads the files. Nothing here affects rendering or the deterministic simulation.
 */
export interface AudioFrame {
  time: number;
  camera: THREE.Camera;
  /** ?light=day: clubs and bars mostly quiet. */
  day: boolean;
  /** Rain strength 0..1 (src/scene/night.ts). */
  rain: number;
  /** Nearest road cars: x, z, heading sin, cos (length 2 = braking; zero = none). */
  cars: THREE.Vector4[];
}

/** Gains per layer, set against each file's measured level (dBFS RMS in the comment). */
const MIX = {
  ambience: 5,      // -42: the bed, ~-28 dB
  rain: 2.5,        // -42.5: at full rain and street level ~-34 dB, under the ambience
  tyre: 5,          // -42.5: a close pass ~-28 dB
  thunderNear: 0.5, // -25, peak -0.6 (the limiter catches the crack)
  thunderFar: 0.95, // -32
  crowd: 4,         // -40: full nightlife ~-28 dB
  future: 2.5,      // -44: a faint layer, ~-36 dB
  club: 3,          // -36, almost all below 150 Hz: ~-26 dB at the door
  bar: 4.5,         // -41
  arcade: 0.45,     // -21: the loudest file
};
/** Venue kinds, assigned in turn to the densest sign clusters; each is one loop in public/audio/. */
const VENUES = ['club', 'bar', 'arcade'] as const;
type Venue = (typeof VENUES)[number];
/** Nightlife field: σ of the sign-density blur, its grid cell (m), venue count and spacing (m). */
const NIGHTLIFE = { sigma: 40, cell: 20, venues: 12, spacing: 55, from: 0.45, full: 0.95 };

/**
 * Street-level sign density on a grid, normalised to its peak, plus the venue spots: the
 * densest signs at least `spacing` apart, kinds in turn. Deterministic for a layout.
 */
function nightlifeOf(layout: Layout | null) {
  const pts = (layout?.signs ?? [])
    .filter((s) => (s.zone ?? 'street') === 'street' && s.position[1] < 20)
    .map((s) => [s.position[0], s.position[2]] as const);
  if (!pts.length) return null;
  const { sigma, cell } = NIGHTLIFE;
  const reach = 3 * sigma;
  const x0 = Math.min(...pts.map((p) => p[0])) - reach, z0 = Math.min(...pts.map((p) => p[1])) - reach;
  const nx = Math.ceil((Math.max(...pts.map((p) => p[0])) + reach - x0) / cell) + 1;
  const nz = Math.ceil((Math.max(...pts.map((p) => p[1])) + reach - z0) / cell) + 1;
  const density = (x: number, z: number) => {
    let d = 0;
    for (const [px, pz] of pts) {
      const dx = px - x, dz = pz - z;
      if (Math.abs(dx) < reach && Math.abs(dz) < reach) d += Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma));
    }
    return d;
  };
  const grid = new Float32Array(nx * nz);
  let peak = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const d = density(x0 + i * cell, z0 + j * cell);
    grid[j * nx + i] = d;
    peak = Math.max(peak, d);
  }
  for (let k = 0; k < grid.length; k++) grid[k] /= peak;
  /** Bilinear density 0..1 at (x, z); 0 outside the grid. */
  const at = (x: number, z: number) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return 0;
    const tx = fx - i, tz = fz - j, k = j * nx + i;
    return (grid[k] * (1 - tx) + grid[k + 1] * tx) * (1 - tz) + (grid[k + nx] * (1 - tx) + grid[k + nx + 1] * tx) * tz;
  };
  const venues: { x: number; z: number; kind: Venue }[] = [];
  const ranked = pts.map(([x, z]) => ({ x, z, d: density(x, z) })).sort((a, b) => b.d - a.d);
  for (const p of ranked) {
    if (venues.length >= NIGHTLIFE.venues) break;
    if (venues.some((v) => Math.hypot(v.x - p.x, v.z - p.z) < NIGHTLIFE.spacing)) continue;
    venues.push({ x: p.x, z: p.z, kind: VENUES[venues.length % VENUES.length] });
  }
  return { at, venues };
}
/** Crossfade between consecutive ambience clips, seconds. */
const AMBIENCE_FADE = 4;

export function createCityAudio(layout: Layout | null) {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let ambience: GainNode, rain: GainNode, tyre: GainNode, tyrePan: StereoPannerNode;
  let crowd: GainNode, future: GainNode;
  const venue = {} as Record<Venue, { gain: GainNode; pan: StereoPannerNode }>;
  let nightlife: ReturnType<typeof nightlifeOf> = null;
  let ambienceClips: AudioBuffer[] = [];
  let thunderNear: AudioBuffer | null = null, thunderFar: AudioBuffer | null = null;
  let clipAt = 0, clipIndex = 0;
  let on = false;
  let lastFlash = 0, strikes = 0;
  const eye = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();

  const gainNode = (out: AudioNode, value = 0) => {
    const g = ctx!.createGain();
    g.gain.value = value;
    g.connect(out);
    return g;
  };
  const panner = (out: AudioNode) => {
    const p = ctx!.createStereoPanner();
    p.connect(out);
    return p;
  };

  /** Fetch and decode one file: Ogg Opus first, AAC where the browser cannot decode Opus. */
  async function load(name: string): Promise<AudioBuffer | null> {
    for (const ext of ['opus', 'm4a']) {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}audio/${name}.${ext}`);
        if (res.ok) return await ctx!.decodeAudioData(await res.arrayBuffer());
      } catch { /* undecodable here: try the next format */ }
    }
    console.warn(`audio: could not load ${name}`);
    return null;
  }

  /** A seamless generated loop, started once it has loaded and left running under its gain. */
  async function loop(name: string, out: AudioNode) {
    const buf = await load(name);
    if (!buf || !ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(out);
    s.start(0, Math.random() * buf.duration);
  }

  function start() {
    ctx = new AudioContext();
    // A limiter on the sum: thunder cracks over the other layers must not clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 3;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    master = gainNode(limiter);
    ambience = gainNode(master);
    rain = gainNode(master);
    tyrePan = panner(master);
    tyre = gainNode(tyrePan);
    void Promise.all(['city-night-a', 'city-night-b'].map(load)).then((b) => { ambienceClips = b.filter((x): x is AudioBuffer => x !== null); });
    void loop('rain-loop', rain);
    void loop('tyre-hiss', tyre);
    crowd = gainNode(master);
    future = gainNode(master);
    void loop('crowd-loop', crowd);
    void loop('future-tones', future);
    for (const kind of VENUES) {
      const pan = panner(master);
      venue[kind] = { gain: gainNode(pan), pan };
      void loop(`${kind}-loop`, venue[kind].gain);
    }
    nightlife = nightlifeOf(layout);
    void load('thunder-near').then((b) => { thunderNear = b; });
    void load('thunder-far').then((b) => { thunderFar = b; });
  }

  /** Keep an ambience clip scheduled ~1 s ahead; each fades in over the previous one's fade-out. */
  function scheduleAmbience(now: number) {
    if (!ambienceClips.length) return;
    if (clipAt < now) clipAt = now + 0.05;   // first clip, or resuming after a mute
    while (clipAt < now + 1) {
      const buf = ambienceClips[clipIndex++ % ambienceClips.length];
      const trim = 0.05;                      // skip encoder padding at both ends
      const len = buf.duration - 2 * trim;
      const fade = Math.min(AMBIENCE_FADE, len / 3);
      const fadeIn = new Float32Array(32), fadeOut = new Float32Array(32);
      for (let i = 0; i < 32; i++) {
        const a = (i / 31) * Math.PI / 2;
        fadeIn[i] = Math.sin(a); fadeOut[i] = Math.cos(a);
      }
      const s = ctx!.createBufferSource();
      s.buffer = buf;
      const g = gainNode(ambience);
      g.gain.setValueCurveAtTime(fadeIn, clipAt, fade);
      g.gain.setValueCurveAtTime(fadeOut, clipAt + len - fade, fade);
      s.connect(g);
      s.start(clipAt, trim, len);
      clipAt += len - fade;
    }
  }

  /** Thunder roll: the near recording (with its crack) for short delays, the far one otherwise. */
  function thunder(at: number, near: number) {
    const buf = near > 0.55 ? thunderNear : thunderFar;
    if (!buf) return;
    const s = ctx!.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 0.88 + Math.random() * 0.17;   // a little variety in pitch and length
    const level = near > 0.55 ? MIX.thunderNear * (0.6 + 0.4 * near) : MIX.thunderFar * (0.5 + 0.9 * near);
    s.connect(gainNode(master, level));
    s.start(at);
  }

  /** -1 (left) .. 1 (right) for a world point relative to the camera's view. */
  const panOf = (x: number, z: number) => {
    const dx = x - eye.x, dz = z - eye.z, l = Math.hypot(dx, dz) || 1;
    return THREE.MathUtils.clamp((dx * right.x + dz * right.z) / l, -1, 1);
  };

  return {
    get enabled() { return on; },
    toggle() {
      if (!ctx) start();
      on = !on;
      if (on) void ctx!.resume();
      master.gain.setTargetAtTime(on ? 0.9 : 0, ctx!.currentTime, 0.3);
      return on;
    },
    update(f: AudioFrame) {
      if (!ctx || !on) return;
      const now = ctx.currentTime;
      f.camera.getWorldPosition(eye);
      f.camera.getWorldDirection(fwd);
      right.set(-fwd.z, 0, fwd.x).normalize();
      const height = Math.max(0, eye.y);
      const street = Math.exp(-height / 60);          // 1 at street level, fading with height

      scheduleAmbience(now);
      if (ambienceClips.length) ambience.gain.setTargetAtTime(MIX.ambience * (0.6 + 0.4 * street), now, 1.0);
      rain.gain.setTargetAtTime(MIX.rain * f.rain * (0.4 + 0.6 * street), now, 0.5);

      // Tyre hiss: each nearby car contributes by distance, the louder ones pull the pan.
      let level = 0, pan = 0;
      for (const c of f.cars) {
        if (c.z === 0 && c.w === 0) continue;
        const d = Math.hypot(c.x - eye.x, c.y - eye.z, height);
        // Close passes only (σ ≈ 9 m): each car is a swoosh, a busy street not a constant hiss.
        const w = Math.exp(-(d * d) / (2 * 9 * 9));
        level += w; pan += w * panOf(c.x, c.y);
      }
      tyre.gain.setTargetAtTime(Math.min(1, level) * MIX.tyre, now, 0.12);
      tyrePan.pan.setTargetAtTime(level > 0.01 ? pan / level : 0, now, 0.12);

      // Thunder: a new flash schedules a roll 1.5–7 s later (distance by the strike).
      const { flash } = lightningAt(f.time);
      if (flash > 0.05 && lastFlash <= 0.05) {
        const delay = 1.5 + 5.5 * ((Math.sin(++strikes * 91.7 + Math.floor(f.time / 40)) * 0.5 + 0.5));
        thunder(now + delay, 1 - (delay - 1.5) / 5.5);
      }
      lastFlash = flash;

      // Nightlife: the bed swells with the sign density here; venues by distance (incl. height).
      const lift = Math.exp(-height / 30);
      const dense = nightlife ? nightlife.at(eye.x, eye.z) : 0;
      const n = THREE.MathUtils.smoothstep(dense, NIGHTLIFE.from, NIGHTLIFE.full) * lift;
      crowd.gain.setTargetAtTime(MIX.crowd * n, now, 0.6);
      future.gain.setTargetAtTime(MIX.future * n, now, 0.6);
      for (const kind of VENUES) {
        let lv = 0, pn = 0;
        for (const v of nightlife?.venues ?? []) {
          if (v.kind !== kind) continue;
          const d = Math.hypot(v.x - eye.x, v.z - eye.z, height);
          const w = 1 / (1 + (d / 8) ** 2);        // ~0.7 at the door, -17 dB at 20 m
          lv += w; pn += w * panOf(v.x, v.z);
        }
        const dayQuiet = f.day && kind !== 'arcade' ? 0.25 : 1;
        venue[kind].gain.gain.setTargetAtTime(Math.min(1, lv) * MIX[kind] * dayQuiet, now, 0.3);
        venue[kind].pan.pan.setTargetAtTime(lv > 1e-3 ? pn / lv : 0, now, 0.3);
      }
    },
  };
}

export type CityAudio = ReturnType<typeof createCityAudio>;
