---
section: Fixed
commits:
  - fix(render): bind streaming resizes to held texture generations
---
**A late texture resize can no longer shrink a sprite or mesh that has reacquired the image.** Releasing the last holder or editing the file removes the handle from streaming. Concurrent size requests apply the latest request, and streaming budgets stop counting released textures.
