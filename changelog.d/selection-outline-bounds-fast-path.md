---
section: Changed
commits:
  - perf(editor): avoid unnecessary hulls in selection bounds queries
---
**Faster outlines for large selections.** The editor can find fully visible selection bounds without building a polygon for each object. Objects crossing the viewport edge still use exact outline clipping.
