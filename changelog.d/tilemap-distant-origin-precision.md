---
section: Fixed
commits:
  - fix(tilemap): keep grid coordinates precise at distant origins
---
**Tile coordinates stay precise far from the world origin.** Grid picking, world-space tile queries, and cell placement retain fractional origins and cell-sized offsets on unrotated layers, matching the rotated conversion path.
