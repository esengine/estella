---
section: Fixed
commits:
  - fix(prefab): retain the targets picked on nested and added instance members
---
**Prefab instances remember which entity you picked after saving, reopening and running a scene.** Bindings can point across nested instances, to their outer root or to newly added members. Ordered references such as skin joints keep their order. A virtual UI page restores its bindings each time its contents are built under the scene mount.
