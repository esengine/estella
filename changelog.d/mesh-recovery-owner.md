---
section: Fixed
commits:
  - fix(assets): restore mesh geometry through its owning loader
---
**Device recovery restores 3D meshes even when a different asset loader starts the recovery.** File-backed meshes are read from their original project, and meshes created at runtime reuse their original geometry. A mesh released during a pending read stays released.
