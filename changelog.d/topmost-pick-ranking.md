---
section: Changed
commits:
  - perf(picking): reduce ordinary ray hits to the frontmost entity
---
**Clicking through dense overlapping sprites spends less time ranking hits.** Single selection uses a linear pass for painter and Y-sort draws. Selection cycling and the ranking for interleaved depth layers and sorting groups retain their existing order.
