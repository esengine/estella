---
section: Fixed
commits:
  - fix(editor): align transform handle picking with draw clipping
  - fix(project): ship transform gizmo clipping consistency
---
**Clipped transform handles no longer intercept the viewport pointer.** Hover, dragging, and Alt navigation agree with the gizmo drawing when a selection is outside the camera's depth range.
