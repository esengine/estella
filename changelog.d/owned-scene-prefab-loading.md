---
section: Fixed
commits:
  - fix(scene): share prefab preparation across scene loading paths
---
**Preview and file-backed scene loads share prefab preparation.** Private scene documents expand prefab instances and register deferred pages through the same path as other loads. Scenes read from files can also skip a second document copy.
