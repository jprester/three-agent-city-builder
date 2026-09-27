import type { CameraMode } from '../systems/cameras';

const HELP: Record<CameraMode, string> = {
  orbit: 'Drag to orbit · right-drag to pan · wheel to zoom',
  fly: 'Click to look · WASD move · Space/E up · C/Q down · Shift boost · wheel speed · Esc release',
  flythrough: 'Cinematic loop',
};
const NAMES: Record<CameraMode, string> = { orbit: 'Orbit', fly: 'Free-fly', flythrough: 'Flythrough' };
/** Seconds the hint stays up after a mode change. */
const HOLD = 6;

/**
 * Camera-mode hint, top left: the active mode, its controls and the 1–3 keys. Fades out after a
 * few seconds; any mode change brings it back. `initial` false keeps it hidden on load (shots).
 */
export function createHud(initial: boolean) {
  const el = document.createElement('div');
  el.id = 'hud';
  document.body.appendChild(el);
  let first = true;
  let timer = 0;
  return {
    show(mode: CameraMode, hasFlythrough: boolean) {
      if (first && !initial) { first = false; return; }
      first = false;
      const keys = `1 Orbit · 2 Free-fly${hasFlythrough ? ' · 3 Flythrough' : ''}`;
      el.innerHTML = `<b>${NAMES[mode]}</b> — ${HELP[mode]}<br><span>${keys}</span>`;
      el.classList.add('on');
      clearTimeout(timer);
      timer = window.setTimeout(() => el.classList.remove('on'), HOLD * 1000);
    },
  };
}
