---
section: Fixed
commits:
  - fix(render): expose camera relative coordinates to viewport draws
  - fix(editor): align large world overlay drawing and handle picking
  - fix(project): ship camera relative viewport handles
---
**Viewport handles stay aligned in large worlds.** Render-space overlays preserve small geometry offsets far from the origin and use the same frame as transform-handle picking.
