---
section: Fixed
commits:
  - fix(tilemap): preserve atlas ranges in both Tiled layer loading paths
---
**Tiled layers keep their atlas boundaries.** Direct imports use each tileset's image, margin and spacing. If a map references a missing atlas image, its tile IDs still belong to that atlas and cannot sample a different one.
