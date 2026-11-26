---
section: Fixed
commits:
  - fix(ui): anchor world popups with the rendered camera projection
---
**World-space tooltips and dropdowns stay aligned far from the origin.** Popup placement uses the same render origin and camera projection as the control it is attached to, in both orthographic and perspective views.
