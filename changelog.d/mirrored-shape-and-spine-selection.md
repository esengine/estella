---
section: Fixed
commits:
  - fix(picking): keep mirrored shape and skeleton bounds at their drawn size
---
**Mirrored shapes and Spine skeletons keep their full selection bounds.** A negative scale no longer shrinks the outline and picking area to the size of the editor icon.
