---
section: Fixed
commits:
  - fix(render): align CPU particle trails with the render origin
---
**CPU particle trails stay attached in large worlds.** World-space particle trails use the same render origin as their particles, so they stay in place as the camera moves far from the world origin.
