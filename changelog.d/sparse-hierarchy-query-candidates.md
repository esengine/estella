---
section: Changed
commits:
  - perf(ecs): read sparse hierarchy query candidates from the core
---
**Sparse hierarchy queries refresh faster in large scenes.** When few entities carry `Parent` or `Children`, the SDK can read those candidates directly from the engine while preserving scene order and inactive-entity filtering.
