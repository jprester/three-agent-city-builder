import * as THREE from 'three';
import { SIGNAL } from '../../art/layouts/lib/traffic.mjs';
import { lightningAt } from '../scene/lightning';
import type { Layout } from './layout';

/**
 * Procedural city sound, synthesized at runtime with the Web Audio API (no files):
 *  - rain: a filtered hiss bed plus scattered droplet ticks, following the rain waves;
 *  - city: a low hum and a mid-band traffic roar (audible on small speakers), more from higher up;
 *  - tyre hiss: the nearest simulated cars swish past on the wet road, panned toward them;
 *  - thunder: a rumble a few seconds after each lightning flash (src/scene/lightning.ts),
 *    louder and sharper the shorter the delay;
 *  - crossing chirps: the "piyo piyo" of a Japanese pedestrian signal near a junction whose
 *    crossing is green.
 * Browsers only start audio after a user gesture, so it begins muted; `toggle()` (button, M
 * key) turns it on. Nothing here affects rendering or the deterministic simulation.
 */
export interface AudioFrame {
  time: number;
  camera: THREE.Camera;
  /** Rain strength 0..1 (src/scene/night.ts). */
  rain: number;
  /** Nearest road cars: x, z, heading sin, cos (length 2 = braking; zero = none). */
  cars: THREE.Vector4[];
}

export function createCityAudio(layout: Layout | null) {
  let ctx: AudioContext | null = null;
  let master: GainNode, rainBed: GainNode, hum: GainNode, roar: GainNode, hiss: GainNode, hissPan: StereoPannerNode;
  let noise: AudioBuffer;
  let on = false;
  let lastFlash = 0, nextDrop = 0, nextChirp = 0, strikes = 0;
  const signals = layout?.signals ?? [];
  const eye = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();

  const noiseSource = () => {
    const s = ctx!.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    return s;
  };
  /** A looping noise bed, started at a random offset so layers sharing the buffer decorrelate. */
  const bed = () => { const s = noiseSource(); s.start(0, Math.random() * 3); return s; };
  const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
    const f = ctx!.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  };
  const chain = (...nodes: AudioNode[]) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };

  function start() {
    ctx = new AudioContext();
    const rate = ctx.sampleRate;
    noise = ctx.createBuffer(2, rate * 4, rate);
    for (let c = 0; c < 2; c++) {
      const d = noise.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    // Rain bed: broadband hiss, rolled off at both ends.
    rainBed = ctx.createGain();
    rainBed.gain.value = 0;
    chain(bed(), filter('highpass', 600), filter('lowpass', 4500), rainBed, master);
    // City hum: very low rumble.
    hum = ctx.createGain();
    hum.gain.value = 0;
    chain(bed(), filter('lowpass', 160), filter('highpass', 30), hum, master);
    // Distant traffic roar: a mid band small speakers can play (the hum alone is below them).
    roar = ctx.createGain();
    roar.gain.value = 0;
    chain(bed(), filter('bandpass', 420, 0.6), filter('lowpass', 900), roar, master);
    // Tyre hiss on wet asphalt: a mid band, panned toward the passing cars.
    hiss = ctx.createGain();
    hiss.gain.value = 0;
    hissPan = ctx.createStereoPanner();
    chain(bed(), filter('bandpass', 1400, 0.5), filter('lowpass', 4500), hiss, hissPan, master);
  }

  /** A short filtered noise burst: rain drops and thunder crackle. */
  function burst(at: number, dur: number, freq: number, q: number, gain: number, pan = 0) {
    const s = noiseSource();
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + Math.min(0.004, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    const p = ctx!.createStereoPanner();
    p.pan.value = pan;
    chain(s, filter('bandpass', freq, q), g, p, master);
    s.start(at, Math.random() * 3);
    s.stop(at + dur + 0.05);
  }

  /** Thunder: a low rumble with slow swells, a crack first when the strike is close. */
  function thunder(at: number, near: number) {
    const dur = 3.5 + 3 * (1 - near);
    const s = noiseSource();
    const g = ctx!.createGain();
    const lp = filter('lowpass', 500 + 900 * near, 0.6);
    const curve = new Float32Array(64);
    for (let i = 0; i < curve.length; i++) {
      const t = i / (curve.length - 1);
      const swell = 0.6 + 0.4 * Math.sin(t * 9 + Math.random() * 2) * Math.random();
      curve[i] = (0.5 + 0.5 * near) * Math.min(1, t * 12) * Math.exp(-t * 3.2) * swell;
    }
    g.gain.setValueAtTime(0, at);
    g.gain.setValueCurveAtTime(curve, at, dur);
    chain(s, lp, g, master);
    s.start(at, Math.random() * 3);
    s.stop(at + dur + 0.1);
    if (near > 0.6) burst(at, 0.35, 900, 0.4, 0.4 * near);
  }

  /** "Piyo": a short rising sine chirp. */
  function chirp(at: number, gain: number, pan: number) {
    const o = ctx!.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2700, at);
    o.frequency.linearRampToValueAtTime(3300, at + 0.07);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.01);
    g.gain.linearRampToValueAtTime(0, at + 0.09);
    const p = ctx!.createStereoPanner();
    p.pan.value = pan;
    chain(o, g, p, master);
    o.start(at);
    o.stop(at + 0.1);
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
      rainBed.gain.setTargetAtTime(f.rain * (0.015 + 0.035 * street), now, 0.5);
      hum.gain.setTargetAtTime(0.12 + 0.1 * (1 - street), now, 1.0);

      // Tyre hiss: each nearby car contributes by distance, the louder ones pull the pan.
      let level = 0, pan = 0;
      for (const c of f.cars) {
        if (c.z === 0 && c.w === 0) continue;
        const d = Math.hypot(c.x - eye.x, c.y - eye.z, height);
        // Close passes only (σ ≈ 9 m): each car is a swoosh, a busy street not a constant hiss.
        const w = Math.exp(-(d * d) / (2 * 9 * 9));
        level += w; pan += w * panOf(c.x, c.y);
      }
      hiss.gain.setTargetAtTime(Math.min(1, level) * 0.45, now, 0.12);
      // The roar: the city's traffic in general, more of it with cars around and from the air.
      roar.gain.setTargetAtTime(0.08 + 0.05 * (1 - street) + 0.03 * Math.min(1, level), now, 0.8);
      hissPan.pan.setTargetAtTime(level > 0.01 ? pan / level : 0, now, 0.12);

      // Droplets: ticks off awnings and puddles, more of them in heavy rain at street level.
      if (now > nextDrop) {
        burst(now + Math.random() * 0.05, 0.02 + Math.random() * 0.04, 2500 + Math.random() * 3500, 4, 0.03 * f.rain * street, Math.random() * 2 - 1);
        nextDrop = now + (0.03 + Math.random() * 0.12) / Math.max(0.2, f.rain);
      }

      // Thunder: a new flash schedules a rumble 1.5–7 s later (distance by the strike).
      const { flash } = lightningAt(f.time);
      if (flash > 0.05 && lastFlash <= 0.05) {
        const delay = 1.5 + 5.5 * ((Math.sin(++strikes * 91.7 + Math.floor(f.time / 40)) * 0.5 + 0.5));
        thunder(now + delay, 1 - (delay - 1.5) / 5.5);
      }
      lastFlash = flash;

      // Crossing chirps: the nearest signal within 45 m, while its crossing (the other phase) is green.
      if (now > nextChirp && height < 25) {
        let best: (typeof signals)[number] | null = null, bd = 45;
        for (const s of signals) {
          const d = Math.hypot(s[0] - eye.x, s[1] - eye.z);
          if (d < bd) { bd = d; best = s; }
        }
        if (best) {
          const t = (((f.time + best[3] * SIGNAL.period) % SIGNAL.period) + SIGNAL.period) % SIGNAL.period;
          const carsGo = best[4] === 0 ? t : t - (SIGNAL.green + SIGNAL.amber);
          const crossing = !(carsGo >= 0 && carsGo < SIGNAL.green + SIGNAL.amber);
          if (crossing) {
            const g = 0.18 * (1 - bd / 45), p = panOf(best[0], best[1]);
            chirp(now, g, p);
            chirp(now + 0.16, g * 0.8, p);
          }
        }
        nextChirp = now + 1.1;
      }
    },
  };
}

export type CityAudio = ReturnType<typeof createCityAudio>;
