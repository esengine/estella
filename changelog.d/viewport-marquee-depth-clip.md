---
section: Fixed
commits:
  - fix(editor): clip viewport selection bounds to the drawn camera
---
**Viewport selection follows the camera’s depth range.** Marquee selection and selection outlines follow visible object bounds across the camera’s near and far planes. Objects fully beyond either plane are no longer included in the marquee.
