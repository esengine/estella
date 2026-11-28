---
section: Changed
commits:
  - perf(animation): avoid building transition paths until an edge fires
---
**Animator updates allocate less when checking nested transitions.** The shared 2D and 3D evaluator walks the authored edges in priority order and builds the target path only when a transition fires.
