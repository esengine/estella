---
section: Changed
commits:
  - perf(terrain): skip overview sampling in full heightmap exports
---
**Full terrain heightmap exports do less work.** Estella builds the full image directly from its tiles. Exports of loaded tiles
still use the overview for areas outside those tiles.
