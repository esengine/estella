---
section: Changed
commits:
  - perf(nav): narrow crowd searches and reuse steering geometry
---
**Crowds spend less time finding neighbours and steering around them.** Two-dimensional grids and three-dimensional navigation meshes on web and native share the same nearby-body search. Agents keep their original avoidance order and check the ground before choosing a velocity.
