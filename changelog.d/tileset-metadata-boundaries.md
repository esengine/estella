---
section: Fixed
commits:
  - fix(tilemap): keep tileset metadata inside its tile IDs
---
**Tilesets keep their own collision, properties, and animation.** The collision preview and runtime ignore metadata and animation frames outside the tileset's tile ID range, preventing them from affecting neighboring tilesets on the same layer.
