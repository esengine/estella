---
section: Fixed
commits:
  - fix(ecs): refresh hierarchy queries after engine-side parenting
---
**Entity queries follow engine-side parenting edits.** Cached queries for `Parent` and `Children`, including queries that use them as filters, now reflect entities attaching to or detaching from the hierarchy.
