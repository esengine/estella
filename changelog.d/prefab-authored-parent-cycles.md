---
section: Fixed
commits:
  - fix(scene): validate parent cycles before expanding prefabs
---
**Scene loads report circular parenting before resolving prefab assets.** The runtime checks the authored hierarchy even when a prefab is missing or an alternate layout is skipped, and reports the offending entity IDs before changing the world.
