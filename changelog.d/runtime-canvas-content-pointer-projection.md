---
section: Fixed
commits:
  - fix(input): map browser pointers through the canvas content box
---
**Browser pointer picking follows the actual rendered canvas size.** Camera queries, world UI and HUD map CSS pointer offsets to the framebuffer using the canvas's measured content box, including when display and rendering resolutions differ.
