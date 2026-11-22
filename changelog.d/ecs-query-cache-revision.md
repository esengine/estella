---
section: Changed
commits:
  - perf(ecs): reuse query validation across unchanged component revisions
---
**Repeated entity queries cost less in 2D and 3D systems.** Systems looking up the same component combinations can reuse their results without scanning the dependencies on every call. Adding or removing a component still refreshes the queries it affects.
