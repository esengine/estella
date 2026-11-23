---
section: Changed
commits:
  - perf(ecs): reuse hierarchy validation across unchanged joint lookups
---
**Animation spends less time looking up joints in a stable hierarchy.** Timelines and controllers share a check for changes to child names and parent links. Renamed, replaced and reparented joints are picked up on the next lookup.
