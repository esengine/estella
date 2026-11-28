---
section: Fixed
commits:
  - fix(scene): stream proximity cells from the focus entity's world position
---
**Scene streaming follows parented entities in 2D and 3D.** The proximity streamer selects cells from the focus entity's world position after the frame's movement, including movement inherited from its parent.
