---
section: Fixed
commits:
  - fix(tilemap): resolve Tiled objects from their unflagged tile IDs
---
**Tiled tile objects select the correct atlas cell after a map orientation change.** Import strips all four flag bits from the tile ID before resolving the tileset. Objects whose atlas cell or texture is missing are skipped.
