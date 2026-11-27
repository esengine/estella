---
section: Fixed
commits:
  - fix(runtime): load deferred scenes from the active manifest revision
---
**Deferred scenes load their updated files after a hot update.** Switching to a registered scene uses its stable asset key, so a newly activated or restored manifest can point to a different staged file.
