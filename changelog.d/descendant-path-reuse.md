---
section: Changed
commits:
  - perf(ecs): reuse complete descendant paths within a hierarchy revision
---
**Repeated lookups of named sprite and bone paths take less time.** Animation and other systems that address descendants by name reuse successful lookups until the hierarchy changes. Renaming or moving a node takes effect on the next lookup.
