---
section: Fixed
commits:
  - fix(camera): share pixel bounds for split viewports
---
**Split camera views line up on odd-sized windows and render textures.** Adjacent views share their pixel boundary, and camera projection and pointer picking use the same pixel bounds as the draw pass.
