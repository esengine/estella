---
section: Changed
commits:
  - perf(terrain): reuse the tile index when preparing saves
---
**Saving edits to large tiled terrain prepares changed tiles faster.** The save path uses the terrain's existing tile index to find each changed tile and its output file.
