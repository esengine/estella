---
section: Fixed
commits:
  - fix(render): expose camera relative coordinates to viewport draws
---
**Viewport handles stay aligned in large worlds.** Render-space overlays preserve small geometry offsets far from the origin and use the same frame as transform-handle picking.
