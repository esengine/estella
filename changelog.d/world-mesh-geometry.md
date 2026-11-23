---
section: Fixed
commits:
  - fix(render): upload and save inline mesh geometry in its owning world
---
**Each world loads and saves its own inline mesh geometry.** Previewing two scenes with matching entity IDs preserves both meshes, including after either preview closes. Uploads also preserve vertex colors and indices when a larger mesh makes WebAssembly grow its memory.
