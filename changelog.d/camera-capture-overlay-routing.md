---
section: Fixed
commits:
  - fix(render): route frame overlays to the capture surface
---
**Camera captures include overlays on their output surface.** Immediate rendering into a texture uses that texture's camera for final overlays, and intermediate texture cameras do not receive those overlays.
