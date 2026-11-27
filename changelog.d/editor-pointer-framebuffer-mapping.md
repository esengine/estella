---
section: Fixed
commits:
  - fix(editor): map pointer input through the displayed canvas size
---
**Pointer input stays aligned with the viewport at fractional display scaling.** Edit and Play share the canvas-to-framebuffer conversion used by world and UI picking and dragging.
