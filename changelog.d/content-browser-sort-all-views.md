---
section: Fixed
commits:
  - fix(editor): honor file size and modified sorting in all asset views
---
**The Content Browser sorts by file size or modification time in lists, grids, and columns.** The selected sort still works after switching views or refreshing the folder. Files with unavailable details sort after those with known values.
