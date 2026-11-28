---
section: Fixed
commits:
  - fix(tilemap): reject oversized Tiled layer IDs in preview and export
---
**Tiled maps report tile-layer IDs that exceed Estella’s 8191 limit.** Preview and packaging identify the offending layer and chunk before an out-of-range ID can become a different tile. Standalone tile objects keep their full Tiled IDs.
