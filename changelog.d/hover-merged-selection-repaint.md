---
section: Changed
commits:
  - perf(editor): reuse merged selection bounds during hover
---
**Hover stays responsive with large selections.** Moving the pointer over objects keeps an unchanged merged selection outline in place, while changes to the camera, scene, or selection still redraw it.
