---
section: Fixed
commits:
  - fix(preview): include shapes alongside sprites and meshes
---
**Prefab previews keep shapes in frame when they share an entity with a sprite.** The preview fits the visible mesh, sprite and shape individually, so moving those components onto one entity keeps the artwork framed.
