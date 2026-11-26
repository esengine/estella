---
section: Fixed
commits:
  - fix(runtime): share visibility resolution with live snapshots
---
**The Play hierarchy eye follows the entity's current renderers.** It can show and hide renderers added by the engine, and script renderer aliases preserve the expected visibility priority.
