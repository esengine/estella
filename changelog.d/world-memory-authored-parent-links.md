---
section: Fixed
commits:
  - fix(world): restore streamed deletions through authored parent links
---
**Deleted streamed entities stay gone when their cell reloads.** Remembered deletions follow the same parent links as scene loading, so stale child lists cannot remove a sibling or bring back a descendant. Deep branches are handled iteratively.
