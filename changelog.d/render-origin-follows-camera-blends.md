---
section: Fixed
commits:
  - fix(camera): follow the resolved view with the render origin
---
**The floating origin follows camera cuts and blends.** Rendering and picking keep their precision when a different camera takes over or the view moves between distant cameras.
