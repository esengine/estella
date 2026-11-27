---
section: Fixed
commits:
  - fix(editor): keep tile palette picks inside the active tileset
---
**The tile palette picks the same tile IDs the game renders.** The palette and brush previews use the tileset’s declared column stride and exclude cells beyond its ID range, including gaps in a partially filled last row.
