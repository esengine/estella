---
section: Fixed
commits:
  - fix(editor): clip projected selection outlines to the drawn viewport
---
**Selection outlines stay inside the picture.** The viewport and UI debugger clip outlines to the region that drew the selected object. HUD outlines follow the overlay viewport, and UI resize handles still follow the authored layout edges.
