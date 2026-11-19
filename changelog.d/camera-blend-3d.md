---
section: Fixed
commits:
  - fix(camera): a blend between 3D cameras turns the view from one to the other, and a shake moves a 3D camera across its own screen
---
**A camera blend between two 3D cameras turns the view instead of snapping it to face -Z.** `setViewTarget` with a blend time, and a timeline camera track blending two shots, drew every frame of the blend looking straight down -Z and jumped to the target camera's direction when the blend ended: the blend carried only the 2D roll. It now turns the camera the short way round from one orientation to the other. `shakeCamera` on a 3D camera also shakes it across its own screen and rolls it about where it looks; before, it moved the camera in world X and Y, which for a camera looking along X was toward what it sees, and the roll did nothing.
