---
section: Fixed
commits:
  - fix(editor): persist painted ground from a single snapshot
  - fix(terrain): save landscape images as one edit
---
**Saving painted terrain keeps its height and layer weights together.** The editor captures an area's heightmap and both weightmaps before writing, scans the assets once, and updates the scene's image references together. A failed write leaves the terrain marked for saving. Overlapping saves preserve the order of the edits.
