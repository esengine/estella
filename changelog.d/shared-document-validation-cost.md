---
section: Changed
commits:
  - perf(document): reduce scene and prefab validation work
---
**Scene and prefab validation does less work.** It checks parent chains in one pass and skips temporary component sets for entities with zero, one, or two different components.
