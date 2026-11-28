---
section: Changed
commits:
  - perf(editor): reuse Content Browser type lookups during filtering and sorting
---
**Sorting the Content Browser by type resolves each file's type once per refresh.** Type search and sorting share the lookup, and a plain name sort skips it.
