---
section: Fixed
commits:
  - fix(tilemap): report missing local tileset inputs during builds
---
**Tilemap builds report missing local tilesets and images.** The asset cook names the map or tileset and the exact unresolved reference, so a missing image does not first surface as invisible tiles at runtime.
