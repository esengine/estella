---
section: Changed
commits:
  - perf(ui): query only text fields missing input components
---
**Text input skips redundant focus and interaction checks on initialized fields.** New fields and fields with missing components are still initialized, and authored settings remain intact.
