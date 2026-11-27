---
section: Fixed
commits:
  - fix(tilemap): resolve indexed Tiled references in preview
---
**Tiled maps in preview can use the same legacy project paths as exported builds.** The loader checks the map or tileset's own directory first, then looks in the project index for unqualified tileset and image paths.
