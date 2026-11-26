---
section: Fixed
commits:
  - fix(scene): roll back incomplete hierarchy loads
---
**The scene loader now reports a failure when the world rejects a parent link or a load callback removes a newly created entity.** The loader cleans up the entities created by the failed load.
