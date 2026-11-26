---
section: Fixed
commits:
  - fix(scene): isolate saved mesh geometry and particle settings
---
**Saved meshes and particle effects retain the data the engine imported.** Edits to the original input or to a captured scene record no longer change a later save of inline geometry, gradients, size curves, or bursts.
