---
section: Fixed
commits:
  - fix(world): compose cell bounds from affine transforms
---
**Streamed cells cover children under rotated, non-uniformly scaled ancestors.** 2D and 3D cell bounds now use the same matrix composition as the game. Cutting scenes with many top-level entities also avoids repeatedly scanning the root list.
