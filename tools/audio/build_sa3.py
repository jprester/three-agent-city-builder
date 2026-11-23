"""City sounds from Stable Audio 3, reproducibly: art/external/audio/sa3.def.json -> art/external/audio/<name>.opus.

    python3 tools/audio/build_sa3.py [name ...]     then: npm run audio

Each take is rendered once with `sa3 <prompt> <seconds> <model> --seed <seed>` (model sm-sfx
unless `model` says otherwise, e.g. medium for music) and cached in build/audio-sa3/ (keyed by
prompt, length, seed, model). It is then trimmed; a loop gets its last `loop` seconds crossfaded
(equal power) over its first ones, so it repeats without a seam; a one-shot or a playlist track
gets fades (`fade`: in, out); `normalize` sets its RMS level (dBFS). Needs sa3 and ffmpeg on
PATH, and numpy.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DEF = ROOT / 'art' / 'external' / 'audio' / 'sa3.def.json'
CACHE = ROOT / 'build' / 'audio-sa3'
OUT = ROOT / 'art' / 'external' / 'audio'
SR = 48000


def render(s):
    model = s.get('model', 'sm-sfx')
    key = hashlib.sha256(json.dumps([s['prompt'], s.get('negative', ''), s['seconds'], s['seed'], model]).encode()).hexdigest()[:12]
    wav = CACHE / f"{s['name']}-{s['seed']}-{key}.wav"
    if not wav.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        cmd = ['sa3', s['prompt'], str(s['seconds']), model, '--seed', str(s['seed']), '--out', str(wav)]
        if s.get('negative'):
            cmd += ['--negative-prompt', s['negative']]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    return wav


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


def build(s):
    x = decode(render(s))
    a, b = (int(t * SR) for t in s['trim'])
    x = x[a:b]
    if 'loop' in s:
        n = int(s['loop'] * SR)
        t = np.linspace(0, np.pi / 2, n, dtype=np.float32)[:, None]
        # Output: crossfade(tail, head) then the middle; the middle's end runs on into the tail's start.
        head, mid, tail = x[:n], x[n:-n], x[-n:]
        x = np.concatenate([tail * np.cos(t) + head * np.sin(t), mid])
    if 'fade' in s:
        fi, fo = (int(t * SR) for t in s['fade'])
        x[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)[:, None]
        x[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)[:, None] ** 2
    if 'normalize' in s:
        x *= 10 ** ((s['normalize'] - 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)) / 20)
    out = OUT / f"{s['name']}.opus"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                    '-c:a', 'libopus', '-b:a', '128k', str(out)], input=x.tobytes(), check=True)
    rms = 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)
    print(f"{s['name']}: seed {s['seed']}, {len(x) / SR:.1f} s{' loop' if 'loop' in s else ''}, {rms:.1f} dBFS RMS -> {out.relative_to(ROOT)}")


if __name__ == '__main__':
    only = set(sys.argv[1:])
    for s in json.loads(DEF.read_text())['sounds']:
        if not only or s['name'] in only:
            build(s)
