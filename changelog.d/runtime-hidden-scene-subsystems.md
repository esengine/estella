---
section: Changed
commits:
  - perf(scene): skip subsystem preparation for invisible entities
---
**Hidden scene entities no longer trigger runtime physics or localization preparation.** Scenes request the 2D and 3D physics modules and look up locale tables based on the entities they spawn. Projects with explicitly enabled 2D physics still initialize it for bodies spawned by gameplay.
