---
section: Changed
commits:
  - perf(editor): reuse entity picker search text within a scene revision
  - perf(project): ship faster entity picker searches
---
**Entity picker searches respond faster in large scenes.** Repeated searches reuse names, IDs, and hierarchy paths while preserving result order and refreshing when entities are renamed or moved.
