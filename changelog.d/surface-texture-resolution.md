---
section: Fixed
commits:
  - fix(render): preserve imported texture resolution for unmeasured surfaces
---
**Sprites, tilesets and project components get the imported texture resolution when they share an image with a mesh.** Scene preload restores a streamed preview on the same handle before publishing the scene. Live texture and material fields follow their declared resolution requirements, including textures inherited from a parent material. Mesh-only scenes can still start with a smaller image.
