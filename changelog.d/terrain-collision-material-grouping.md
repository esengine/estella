---
section: Changed
commits:
  - perf(terrain): streamline collision triangle grouping by physical material
---
**Painted terrain groups collision triangles faster.** The collision builder reads triangle indices directly and shares its strongest-layer rule with terrain inspection. Missing weights use the terrain's default physical settings.
