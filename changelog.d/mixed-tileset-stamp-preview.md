---
section: Fixed
commits:
  - fix(editor): show all tilesets used by a tile stamp
---
**Tile stamps can preview tiles from more than one tileset.** The brush ghost and stamp thumbnails load the atlas that owns each tile ID, while the active palette stays on the selected tileset.
