---
section: Fixed
commits:
  - fix(picking): use the rendered basis for parented sprites
---
**Sprite selection follows the drawn quad under a scaled parent.** Clicking, marquee selection and prefab framing use the rendered corners when a rotated child inherits non-uniform scale. This also covers mirrored parents and off-center sprite pivots.
