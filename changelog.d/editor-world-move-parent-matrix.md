---
section: Fixed
commits:
  - fix(editor): place world-space moves using the composed parent matrix
---
**World-space moves land where intended under rotated, non-uniformly scaled hierarchies.** Editing and Play use the engine's composed parent matrix, so nested 2D and 3D objects follow viewport moves even through grouping nodes without their own Transform.
