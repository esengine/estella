---
section: Fixed
commits:
  - fix(editor): test marquee selection against projected outlines
---
**Marquee selection follows projected outlines.** Rotated and edge-on objects are selected when the marquee meets their projected bounds. Dragging across an empty corner of the enclosing screen rectangle leaves the object unselected.
