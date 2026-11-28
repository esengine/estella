---
section: Changed
commits:
  - perf(assets): reuse directory entries when checking for orphan assets
---
**Projects with existing asset metadata scan faster when opened.** The asset scanner reuses directory entries to find files that already have a `.meta` sidecar and checks the filesystem for files that may still need one.
