---
section: Changed
commits:
  - perf(water): trace refracted sunlight to opaque receivers
---
**Water caustics follow the surfaces they strike.** Refracted sunlight gathers on terrain and moving meshes in a shared light-space map on both sides of the waterline. A lower-resolution field supplies underwater shafts, reducing the number of full-detail light footprints drawn per update.
