---
section: Fixed
commits:
  - fix(tilemap): load uncompressed Base64 Tiled layers
---
**Uncompressed Base64 Tiled maps keep their placed tiles.** Fixed and infinite layers preserve tile IDs and flip flags. The asset cook reports unsupported compression or malformed Base64 with the affected layer and tells you how to re-export Tiled XML maps as JSON.
