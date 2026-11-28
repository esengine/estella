---
section: Changed
commits:
  - perf(editor): bound tile paint previews in tilted perspective views
---
**Large tile paint previews are faster in tilted views.** The editor skips off-screen cells when every canvas corner projects onto the tile layer ahead of the camera.
