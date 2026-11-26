---
section: Fixed
commits:
  - fix(camera): align picking with the render resolution fallback
---
**Camera picking follows the rendered image when display scaling is unavailable.** If the rendering backend cannot start post-processing, the scene fills its viewport and pointer coordinates use those same bounds.
