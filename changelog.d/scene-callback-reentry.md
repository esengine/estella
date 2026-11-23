---
section: Fixed
commits:
  - fix(scene): register pending operations before invoking scene callbacks
---
**Scene callbacks can request the same scene while it is loading or unloading.** A load requested from setup receives the completed scene, and `whenLoadsSettle()` includes that scene. During cleanup, a second unload joins the first and a same-name load waits for the old scene to leave.
