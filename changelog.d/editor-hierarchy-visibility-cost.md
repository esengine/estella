---
section: Changed
commits:
  - perf(editor): reuse inherited visibility across hierarchy projection
---
**Deep hierarchies take less time to appear in the viewport.** Newly inserted or restored entities reuse the visibility already resolved for their ancestors, and hierarchy and visibility edits refresh those answers.
