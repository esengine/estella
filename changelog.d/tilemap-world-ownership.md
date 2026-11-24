---
section: Fixed
commits:
  - fix(tilemap): keep layer data and rendered chunks in their owning world
  - fix(tilemap): use the edit world for painting and collision previews
---
**Tilemaps keep their own tiles when a scene and its preview share one engine.** Painting, saving, collision queries and rendering now use the layer's world. Closing a preview preserves the other scene's tiles and its queued draws.
