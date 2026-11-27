---
section: Changed
commits:
  - perf(tilemap): fill rectangles in contiguous chunk rows
---
**Large tile rectangles fill and erase faster.** Rectangle edits look up each tile chunk once per row while preserving cell values and chunk revisions.
