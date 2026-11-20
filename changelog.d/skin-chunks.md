---
section: Added
commits:
  - feat(render): skinned meshes past 256 bones are drawn in chunks, with byte-sized skin channels
  - feat(editor): Skinning in Project Settings, and a model's own bone influence limit
---
**Skinned meshes with any number of bones, at a third of the skin memory.** A skinned mesh bound to more bones than one draw can carry (256) used to be imported static. It is now split into chunks of at most that many bones, each drawn on its own with only its bones uploaded. Joint indices are stored as one byte instead of two and weights as one byte instead of four, so a vertex's skin data takes 8 bytes instead of 24. **Project Settings > Rendering > Skinning** sets the bones one draw carries, for every platform and per platform or group (`mobile`, `desktop`, or a platform id), and an export for a platform with a smaller budget splits its meshes again. It also sets the default bone influence limit and 16-bit high-precision weights; a model can override both in its import settings under Skinning. Re-import a model to apply new settings to it.
