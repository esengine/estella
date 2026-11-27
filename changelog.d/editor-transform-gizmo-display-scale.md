---
section: Fixed
commits:
  - fix(editor): align transform gizmo drawing and picking with display scale
---
**Transform handles stay aligned with their hit areas when the viewport is scaled.** The editor uses the displayed canvas proportions to size and orient the handles, matching the geometry sent to the renderer.
