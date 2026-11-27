---
section: Fixed
commits:
  - fix(input): preserve fractional offsets on scaled browser canvases
---
**Touch and outside-canvas drags follow the scaled canvas.** Browser input uses the canvas's fractional layout size and border to map touch events and mouse events that continue outside the canvas.
