---
section: Fixed
commits:
  - fix(tilemap): preserve sparse layers in zero-size infinite Tiled maps
---
**Infinite Tiled maps open and export with empty layers.** The editor preview and packaged runtime accept zero nominal map dimensions for infinite maps and keep layers with an empty chunk list sparse.
