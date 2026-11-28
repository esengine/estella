---
section: Fixed
commits:
  - fix(scene): preserve cancellation when prefab cleanup fails
---
**A prefab cleanup error no longer replaces a scene cancellation or preparation error.** Temporary asset cleanup failures are logged while the original failure remains visible to the caller.
