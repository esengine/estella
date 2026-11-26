---
section: Changed
commits:
  - perf(editor): skip unused Play visibility detail queries
---
**Keeping bulk Play visibility edits takes less work at Stop.** Visibility is read from a single hierarchy snapshot, and component details are requested only for entities with property edits.
