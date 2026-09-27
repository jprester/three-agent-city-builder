# Reference-driven visual upgrade

Authorized in chat, 2026-09-26. Keep the compact city and practical warm/cool palette.
Existing canyon, facade and rooftops cameras are fixed comparison views. Add a wider
skyline view rather than overwriting the previous skyline framing.

1. Record comparison views and choose existing slab_a / tower_a as benchmarks.
2. Add reusable architectural depth, service details, and tower structure; rebuild benchmarks.
3. Improve material response and directional/local lighting; review the benchmark in context.
4. Apply successful options selectively to more existing variants within the scene budget.
5. Add depth through local cool atmospheric scattering and a composed skyline view.
6. Refine storefront interiors, signage stability and wet street detail.
7. Improve cloud forms and restrained street motion; final all-view validation.

No layout expansion, baseline approval, new dependencies, or externally sourced art needed.
The visual review and counts are automated; the human measures the 60-fps target on hardware.

Completed 2026-09-27. All seven steps received an implementation pass; screenshots and
preview sheets are in `docs/progress/reference-upgrade/`. See `docs/NOTES.md` for the
remaining visual limitations. Validation: 32 unit tests, typecheck, asset budgets and
production build pass. All 14 views render visibly within scene budgets (maximum
2,806,840 triangles, 37 calls, 20 programs). Screenshot comparisons fail only because
approved baselines do not exist; none were created or approved. Hardware FPS remains
unmeasured. Parallel room-ray divisions were guarded after diagnosing a black frame.
