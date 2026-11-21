---
section: Fixed
commits:
  - fix(editor): the viewport marks the spline point Details picks, at once
---
**The viewport follows the spline point Details picks.** Stepping through a spline's or an outline's points with Selected Points in Details changed which point the rows edit, but the viewport went on marking the one picked before until something else (the camera moving) redrew it. It now marks the picked point as soon as it changes.
