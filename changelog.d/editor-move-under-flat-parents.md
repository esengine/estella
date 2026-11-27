---
section: Fixed
commits:
  - fix(editor): preserve local depth when moving under flat parents
---
**2D moves under zero-depth parents keep their stored depth.** The editing and Play viewports use the parent's remaining plane for placement, including under nested rotation and non-uniform scale. Moving a child no longer resets its local depth, so it still has that depth when the parent's Z scale is restored.
