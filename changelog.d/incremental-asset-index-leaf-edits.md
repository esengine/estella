---
section: Changed
commits:
  - perf(assets): skip reference cache reads for leaf asset edits
---
**Replacing ordinary textures or audio files updates the editor’s asset index faster.** Incremental scans skip the project-wide reference cache when the changed files cannot contain references and no referring document needs to be updated.
