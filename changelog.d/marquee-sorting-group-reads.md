---
section: Changed
commits:
  - perf(picking): skip unused sorting groups for area selection
---
**Faster marquee selection in grouped scenes.** Area selection skips sorting-group reads when the camera shows all layers and keeps applying group visibility when the camera filters layers.
