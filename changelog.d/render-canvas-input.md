---
section: Fixed
commits:
  - fix(input): bind browser controls to the render canvas
---
**Mouse, touch and wheel input follow the game canvas on pages with multiple previews.** Editor controls can receive taps while the viewport is detached. When a canvas moves into another window, key presses and mouse releases follow it there.
