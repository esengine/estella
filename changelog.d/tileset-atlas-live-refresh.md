---
section: Fixed
commits:
  - fix(editor): refresh open tileset atlases after disk edits
---
**Open tile palettes and the Tileset Editor refresh when their atlas image changes on disk.** For old tilesets that derive their tile count from the atlas, the painter and collision preview recalculate global tile IDs using the new image dimensions.
