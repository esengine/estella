---
section: Fixed
commits:
  - fix(terrain): refresh collision across edited chunk boundaries
---
**Terrain collision follows height edits across chunk boundaries.** Raising or removing a terrain modifier refreshes collision on both sides of shared edges, including when the edit changes the terrain's height range.
