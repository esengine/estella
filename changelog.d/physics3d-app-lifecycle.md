---
section: Fixed
commits:
  - fix(physics): bind 3D solver lifetime and contacts to the owning app
---
**Each running preview owns its 3D physics world.** Gravity changes, collision damage and moving debris stay in the preview that produced them. Closing a preview during loading discards its late solver, and a failed setup releases the native world.
