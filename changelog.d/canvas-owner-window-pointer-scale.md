---
section: Fixed
commits:
  - fix(input): use the render canvas window scale for pointer projection
---
**Pointer input follows the canvas when it moves between windows.** Camera pointer queries, world UI and HUD use the display scale of the window that owns the canvas, including after docking or popping out the viewport.
