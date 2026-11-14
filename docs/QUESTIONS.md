# Questions for the human

Only questions an agent cannot resolve with a sensible default. Newest at the bottom.

- **Tone mapping**: AgX is in (neutral, handles the bright emissives). ACES would be punchier
  and more saturated but skews bright hues. Keep AgX, or do you want an A/B at checkpoint?
- ~~**Sign text**~~: answered in practice. Most signs now use your atlases and Midjourney
  artwork; stroke-drawn signs are the minority.
- ~~**Screen artwork**~~: answered. You supplied the ads and atlases (2026-09-27).
- ~~**City edge**~~ (2026-09-28): answered. Add the light carpet (done: ground sprawl lights).
- **KTX2 encoder (perf A1, 2026-11-14)**: compressing the tower, sign, wall and interior
  textures needs an encoder. Proposed: `ktx2-encoder@0.6.0` as a pinned npm devDependency
  (MIT, Basis Universal in WebAssembly, no system install). Alternative: KTX-Software's
  `toktx` via Homebrew, documented under "Environment". Which one may I add?
- **KTX2 files in git (perf A1)**: UASTC output for these textures is roughly 25–40 MB in
  total, and every re-encode adds that again to history. Commit them like the GLBs, or
  generate them on `npm install`/`npm run assets` and ignore them?
- **1.3 MB driver buffers (perf A0)**: 600–860 MB of the GPU process is 1.3 MB allocations
  tied to facade-material draws (docs/NOTES.md, A0). Root cause not found and not reproduced
  in isolation. Worth a dedicated investigation before Part B? It decides whether the 1.2 GB
  target is reachable.
- **maxFrameMs (perf A4)**: the scene budget is 50 ms; real frames measure 7.7–10.7 ms median,
  13.5–25.9 ms p95 at 2x/high. Proposed: 33 ms (keeps software-GL shots passing headroom on
  real GPUs). Change it?
