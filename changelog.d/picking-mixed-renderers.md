---
section: Fixed
commits:
  - fix(picking): select mixed entities through each visible renderer
---
**Clicking or marquee-selecting a mixed entity uses its visible mesh, sprite and shape.** Each draw is tested against the camera's layer mask, and overlapping draws from the same entity appear once when cycling selection.
