---
section: Changed
commits:
  - perf(terrain): index the tile coverage used by heightmap imports
---
**Heightmap imports update tiled terrain overviews faster.** Estella indexes the tiles touched by an import so each overview sample
can find its tile without scanning the full selection.
