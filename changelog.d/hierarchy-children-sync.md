---
section: Fixed
commits:
  - perf(ecs): reuse children storage when syncing hierarchy edits
---
**Adding many siblings to a parent allocates less memory.** The engine reuses the parent’s child list during hierarchy edits and notifies change-tracked systems when native subtree deletion removes a child.
