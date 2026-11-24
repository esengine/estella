---
section: Changed
commits:
  - perf(nav): narrow crowd searches and reuse steering geometry
  - fix(nav): preserve project-wide standing query overrides
  - fix(nav): steer overlapping agents out of contact
---
**Crowds spend less time finding neighbours and steering around them.** Two-dimensional grids and three-dimensional navigation meshes on web and native share the same nearby-body search. Agents keep their original avoidance order and check the ground before choosing a velocity.
Overlapping agents can separate and continue around corners when their route opens.
