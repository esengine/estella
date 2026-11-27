---
section: Fixed
commits:
  - fix(editor): align Play selection overlays with the drawn viewport
---
**Play selection outlines follow the rendered frame.** World and HUD outlines respect their camera and viewport boundaries. Play hides clipped move handles while keeping the original drag offset when a gesture starts on a visible outline.
