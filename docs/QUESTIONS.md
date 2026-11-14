# Questions for the human

Only questions an agent cannot resolve with a sensible default. Newest at the bottom.

- **Tone mapping**: AgX is in (neutral, handles the bright emissives). ACES would be punchier
  and more saturated but skews bright hues. Keep AgX, or do you want an A/B at checkpoint?
- ~~**Sign text**~~: answered in practice. Most signs now use your atlases and Midjourney
  artwork; stroke-drawn signs are the minority.
- ~~**Screen artwork**~~: answered. You supplied the ads and atlases (2026-09-27).
- ~~**City edge**~~ (2026-09-28): answered. Add the light carpet (done: ground sprawl lights).
- ~~**KTX2 encoder (perf A1)**~~: went ahead with `ktx2-encoder@0.6.0` (npm devDependency)
  when you said to continue. Say so if you would rather have `toktx`; it is a small swap.
- ~~**KTX2 files in git (perf A1)**~~: answered 2026-11-14. Commit them.
- ~~**1.3 MB driver buffers (perf A0)**~~: solved (docs/NOTES.md, A5). GPU process is now ~790 MB.
- ~~**Frame-time target (perf)**~~: answered 2026-11-14. No more than 5 % late frames and
  full-clock GPU time under 16.7 ms replaces "p95 under 14 ms".
- ~~**maxFrameMs (perf A4)**~~: answered 2026-11-14. Now 33 ms.
