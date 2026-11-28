---
section: Changed
commits:
  - perf(tilemap): reuse chunk lookups during infinite Tiled imports
---
**Large infinite Tiled maps load faster.** Import reuses the destination chunk while reading its cells and preserves the order and values of overlapping chunks.
