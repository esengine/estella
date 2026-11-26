---
section: Changed
commits:
  - perf(ui): reuse child lists during layout traversal
---
**Large UI trees cost less to check on static frames.** The layout engine reuses each parent's child list during traversal and checks for structure changes in the same pass.
