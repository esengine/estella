---
section: Changed
commits:
  - perf(terrain): share height samples when querying ground paint
---
**3D terrain assigns collision materials faster.** Ground paint queries reuse the same height samples for elevation and slope, reducing work when collision chunks are built.
