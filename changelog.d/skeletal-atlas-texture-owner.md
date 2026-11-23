---
section: Fixed
commits:
  - fix(assets): share skeletal atlas pages with their texture owner
---
**Spine and DragonBones share atlas pages with the textures loaded by their App.** Two projects using the same image name keep their own artwork. Standalone previews share an upload between skeletons in the same load and give it back when the last skeleton closes.
