---
section: Fixed
commits:
  - fix(ui): keep fractional wheel input on its intended route
---
**Fractional wheel input stays on its intended route.** When a frame mixes wheel events with and without a pointer position, rounding residue no longer triggers a scroll callback on the hovered control.
