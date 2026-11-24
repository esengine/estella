---
section: Fixed
commits:
  - fix(assets): hold pixel-addressed textures at their imported dimensions
---
**Tilemaps keep every atlas at its imported size when a 3D mesh shares the texture.** Painted maps now calculate tile ranges from the full image, and Tiled layers keep secondary atlases sharp. Bitmap fonts, animation frames, skeleton atlas pages and environment maps use the same loading rule. Custom loaders can request it with `assets.acquireTexture(ref, flipY, 'imported')`. Mesh streaming resumes after the last imported-size reader releases the texture.
