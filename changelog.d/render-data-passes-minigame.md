---
section: Fixed
commits:
  - fix(render): support data passes in builds without post-processing
---
**Lightweight WeChat games can build the renderer with post-processing disabled.** Render targets can still store masks and other data textures using their original values.
