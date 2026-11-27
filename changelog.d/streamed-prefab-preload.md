---
section: Changed
commits:
  - perf(world): prepare streamed prefab roots with bounded concurrency
---
**Play and export can overlap prefab reads when partitioning a streamed scene.** Both use the asset preload concurrency limit and share pending reads across instances and variants.
