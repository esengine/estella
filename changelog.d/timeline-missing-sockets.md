---
section: Changed
commits:
  - perf(ecs): reuse leaf lookups for missing animation targets
---
**2D and 3D animations skip repeated hierarchy reads for missing sockets.** When a clip looks for a target below a leaf entity, the engine remembers that the leaf has no children. Attaching a new target makes it available to the next sample.
