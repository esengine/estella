---
section: Fixed
commits:
  - fix(water): cull fixed zones for a lone editor view
---
**A fixed water zone stops submitting near-surface triangles when the editor moves out of view in a scene without a camera.** Moving back restores the mesh. Scenes with a camera retain the water geometry their camera preview can see.
