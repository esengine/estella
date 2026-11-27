---
section: Fixed
commits:
  - fix(ecs): refresh hierarchy value predicates after reparenting
---
**Cached hierarchy predicates follow reparenting.** A query that checks a specific parent or child list refreshes even when the same entities still carry `Parent` and `Children`.
