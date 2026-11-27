---
section: Fixed
commits:
  - fix(editor): reject gutter-only marquee contact with viewports
---
**Marquees in the gutter stop at the viewport edge.** A marquee selects world and UI content once it enters the drawn viewport. Horizontal and vertical drags can still select along a line inside the picture.
