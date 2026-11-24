---
section: Changed
commits:
  - perf(ecs): avoid root walks when editing scene hierarchies
---
**Deeply nested 2D sprites and 3D nodes take less time to link on native and web.** Scene loading and runtime reparenting now use the depth and traversal data already kept for each hierarchy.
