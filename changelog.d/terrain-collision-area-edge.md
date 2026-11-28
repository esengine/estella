---
section: Fixed
commits:
  - fix(terrain): clip collision triangles to finite terrain bounds
---
**Finite terrain collision ends at the visible edge.** Collision triangles in partial border tiles are clipped to the terrain area, preserving the slope at the edge and removing invisible ground beyond it.
