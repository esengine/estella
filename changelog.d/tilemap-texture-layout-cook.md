---
section: Fixed
commits:
  - fix(tilemap): preserve tile texture layout in cooked builds
---
**Cooked tilemaps keep the images their tile grids expect.** Builds preserve standalone tiles and tileset sheets as whole images, so texture atlasing, resizing, and compression no longer change the inputs used to draw a map.
