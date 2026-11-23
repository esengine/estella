---
section: Fixed
commits:
  - fix(render): scope 2D and 3D physics debug overlays to their world
---
**Two running previews can each show their own physics debug view.** Collider outlines and contact markers follow the owning 2D or 3D world. Reopening or closing one preview preserves the other preview's overlay.
