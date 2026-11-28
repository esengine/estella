---
section: Changed
commits:
  - perf(ecs): reuse unresolved descendant paths until hierarchy changes
---
**Timeline sampling repeats less work on missing targets.** A 2D sprite or 3D bone track with an unresolved child path reuses the lookup while the hierarchy stays the same. Renaming, attaching, or removing a child updates the result on the next lookup.
