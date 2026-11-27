---
section: Changed
commits:
  - perf(editor): retain projected tile grids while the view is still
---
**Tilemap painting reuses the grid overlay while the view is still.** Moving a brush across an isometric or otherwise projected tilemap no longer rebuilds the visible grid on every pointer update. Changing the camera, layer or viewport refreshes the grid.
