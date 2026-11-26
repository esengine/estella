---
section: Fixed
commits:
  - fix(runtime): read the drawable camera aspect after scene loading
---
**A game's initial camera aspect follows the drawable surface.** If a window resizes or a phone rotates while the first scene loads, startup camera data reflects the surface at the end of loading.
