---
section: Fixed
commits:
  - fix(terrain): sample the interior triangle at grid-aligned outer edges
---
**Terrain queries report the slope at grid-aligned outer edges.** Height sampling and ray picking use the triangle inside the terrain, keeping their normals consistent with the collision surface.
