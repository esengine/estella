---
section: Fixed
commits:
  - fix(editor): refresh terrain hover when the presented camera moves
---
**The terrain brush follows the ground under a stationary pointer.** Moving the camera refreshes the idle preview without turning an auto-rotating brush or moving a stroke in progress.
