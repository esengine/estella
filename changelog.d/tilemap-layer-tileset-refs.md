---
section: Fixed
commits:
  - fix(tilemap): share tileset layer references with physics discovery
  - fix(editor): restore legacy tileset references when streamed layers spawn
---
**Tilemap layers use the same tileset references in the editor and in a build.** The editor restores legacy single-tileset layers when their cells stream in. Playable exports now include 2D physics for layers that reference their collision tilesets through the ordered list alone.
