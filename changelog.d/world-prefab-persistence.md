---
section: Fixed
commits:
  - fix(world): honor persistent markers on prefab roots
---
**Prefab roots marked WorldPersistent stay loaded.** Play preview and export honor inherited prefab markers and instance overrides, so streamed entities can safely reference those prefab instances.
