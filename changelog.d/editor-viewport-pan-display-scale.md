---
section: Fixed
commits:
  - fix(editor): pan the viewport using its displayed canvas scale
---
**The scene follows the pointer when panning a scaled viewport.** Orthographic and perspective views use the displayed canvas scale on each axis, and the zoom readout reflects the displayed height.
