---
section: Fixed
commits:
  - fix(editor): use runtime tile ids in the tile palette
---
**The tile palette uses the same global tile IDs as the runtime.** When an older tileset has no explicit tile count and its atlas is unavailable, the palette uses the saved tile metadata to reserve its span. Tiles painted from later tilesets keep their intended IDs.
