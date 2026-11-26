---
section: Changed
commits:
  - perf(ecs): share the live script component name index
---
**Inspecting entities with script components is faster.** Single-entity and hierarchy inspection reuse the same name lookup, and the lookup stays current as project code replaces component definitions.
