---
section: Changed
commits:
  - perf(editor): read Content Browser file sort values once per row
---
**File size and modification time sorting in the Content Browser look up each row's sort value once.** Folders still appear first, and files with unavailable details appear last in either direction.
