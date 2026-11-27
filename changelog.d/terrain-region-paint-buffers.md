---
section: Changed
commits:
  - perf(terrain): reuse paint composition buffers across a region
---
**Painted terrain pages take less time to build.** Terrain streaming reuses the material weights buffer across samples when composing painted layers.
