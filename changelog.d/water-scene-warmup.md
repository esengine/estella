---
section: Fixed
commits:
  - fix(water): wait for the water bake and surface during scene warm-up
---
**Water is ready when scene warm-up finishes.** Scenes that prewarm rendering wait for the water field and its surface material, so underwater absorption appears on the first visible frame even when baking spans several frames.
