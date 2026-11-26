---
section: Fixed
commits:
  - fix(input): align mouse and touch on scaled web canvases
---
**Mouse and touch agree on bordered web canvases and canvases with axis-aligned CSS scaling.** Clicks and drags use canvas-local coordinates from press through release, including when the pointer leaves the canvas.
