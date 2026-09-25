# Questions for the human

Only questions an agent cannot resolve with a sensible default. Newest at the bottom.

- **Git LFS is not installed** (`git lfs` missing; `brew` refuses to run until
  `sudo xcodebuild -license accept`). The phase 0 commit therefore leaves out the LFS-tracked
  files (`public/assets/**/*.glb`, `docs/progress/phase-0/*.png`); they are in the working
  tree. After `sudo xcodebuild -license accept && brew install git-lfs && git lfs install`,
  should I commit them in a follow-up commit, or would you rather commit binaries some other way?
- **Baselines**: none exist yet, so every shot "fails" on a missing snapshot. Phase 0 is not
  a checkpoint. Do you want to approve baselines for the `district_a` shots now, or wait
  for checkpoint 1, when `city` and the facade shader exist?
