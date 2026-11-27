---
section: Fixed
commits:
  - fix(tilemap): export saved chunks in stable coordinate order
---
**Identical tilemaps export the same saved tile data.** Non-empty chunks are saved by row and column, so editing chunks in a different order no longer creates a scene diff when their final contents match.
