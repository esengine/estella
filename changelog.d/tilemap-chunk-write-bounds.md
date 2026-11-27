---
section: Fixed
commits:
  - fix(tilemap): clip chunk writes to reachable cells
---
**Bulk tile writes respect the layer bounds.** Chunks along the edge of a finite layer keep only cells inside the layer. Chunk writes and removals also reject invalid coordinates before they can wrap to another chunk.
