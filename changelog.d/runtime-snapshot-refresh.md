---
section: Fixed
commits:
  - fix(editor): clear Play overlays with their snapshot selection
  - perf(runtime): index renderer visibility for world snapshots
---
**Play clears the selection outline as soon as the running world reports that an entity is gone.** Refreshing the runtime hierarchy also takes less time in projects with many registered renderers.
