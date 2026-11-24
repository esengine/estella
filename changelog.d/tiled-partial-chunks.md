---
section: Fixed
commits:
  - fix(tilemap): preserve rows in partial Tiled chunks
---
**Finite Tiled maps retain tiles along their right edge.** Loading a map whose width ends partway through a chunk now reads each row at its actual width, including the bottom-right corner.
