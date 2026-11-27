---
section: Fixed
commits:
  - fix(world): migrate legacy component records before partitioning
---
**Older scenes and prefabs enter the correct streamed cells.** The editor, Play, and the cooker use the same legacy transform and light migration before assigning entities to cells or calculating their bounds.
