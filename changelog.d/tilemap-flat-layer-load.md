---
section: Changed
commits:
  - perf(tilemap): load only the cells supplied for a flat layer
---
**Bulk tile layer loads process the supplied rows directly.** A short row-major tile buffer leaves the rest of the layer empty without scanning it. Full buffers also avoid checking the input bounds on every cell.
