---
section: Fixed
commits:
  - fix(scene): validate replacement scenes before clearing the world
---
**Replacing a scene keeps the current world intact when validation rejects the new scene.** This includes duplicate entity IDs, cyclic parent links, and scene formats newer than the engine supports.
