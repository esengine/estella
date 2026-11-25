---
section: Fixed
commits:
  - fix(editor): preserve unavailable prefab instances when editing scenes
  - fix(prefab): share prefab source resolution across editing and play
---
**Saving a scene keeps its prefab instances when a source or a nested dependency is unavailable.** The Outliner marks an instance that could not load, and Details identifies the missing reference. Saving, saving as a copy and crash recovery preserve its placement and instance edits. Restore the asset and reopen the scene to edit it again. Play skips unavailable instances and continues with the rest of the scene.
