---
section: Fixed
commits:
  - fix(tilemap): inherit Tiled group layer properties
---
**Imported Tiled groups keep their drawing and positioning settings.** Nested groups pass visibility, tint, opacity, parallax, and offsets to their tile layers. Object positions and tile-object colors also inherit the group settings, and tile collision follows the layer offset.
