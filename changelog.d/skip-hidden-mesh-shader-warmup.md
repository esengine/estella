---
section: Changed
commits:
  - perf(render): skip invisible scene entities during mesh shader warmup
---
**Streamed scene shader warmup skips mesh entities marked invisible in the scene document.** The prepared mesh rows now match the entities that scene loading will spawn.
