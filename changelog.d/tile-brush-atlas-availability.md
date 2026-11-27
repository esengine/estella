---
section: Fixed
commits:
  - fix(editor): keep the tile brush atlas available across palette tabs
---
**The tile brush preview follows the active tileset across palette tabs.** The atlas stays available while reading the Terrain or Stamps tab and after a tileset metadata refresh that leaves the atlas layout unchanged.
