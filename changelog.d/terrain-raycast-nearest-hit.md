---
section: Fixed
commits:
  - fix(terrain): pick the nearest triangle and reuse raycast edge samples
---
**3D terrain picking uses the nearest surface hit.** A low-angle ray that crosses both triangles in a terrain cell now hits the nearer triangle, so the sculpt brush lands on the visible slope. Longer rays reuse the height samples shared by adjacent cells.
