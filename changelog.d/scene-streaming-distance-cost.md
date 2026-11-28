---
section: Changed
commits:
  - perf(scene): skip full distance calculations for distant streaming cells
---
**Large 2D and 3D maps spend less time deciding which scene cells to stream.** The streamer checks a distance bound first and keeps the exact spherical check for cells that could be in range, preserving the load and unload thresholds.
