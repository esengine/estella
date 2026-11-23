---
section: Changed
commits:
  - perf(animation): read reflected components into reusable pose buffers
---
**Animation controllers reuse pose buffers when reading sprites and transforms.** Playing a 2D fade or a 3D character animation uses less CPU time on web and native targets. Scripts that hold a pose's position or color keep the same object across frames.
