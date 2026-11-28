---
section: Changed
commits:
  - perf(terrain): reuse triangle vertices while tracing a terrain ray
---
**Long terrain ray picks allocate less as they cross the grid.** Each ray reuses its four cell vertices while keeping the same nearest intersection and surface normal.
