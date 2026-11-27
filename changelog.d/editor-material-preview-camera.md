---
section: Changed
commits:
  - perf(editor): keep material preview camera changes off the texture load path
---
**Rotating a live material preview or changing its shape reuses the current material.** Camera changes redraw the preview without requesting the same textures or rebuilding the Details form.
