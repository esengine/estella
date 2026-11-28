---
section: Fixed
commits:
  - fix(editor): clip terrain brush picks to the presented camera
---
**Terrain brushes stay inside the view that was drawn.** Sculpting, painting and landscape spline placement use the presented camera's viewport and far plane. A pointer in the margins or over terrain beyond the far plane cannot pick the ground.
