---
section: Changed
commits:
  - perf(editor): batch the snapshots used to keep Play edits
---
**Keeping edits to many Play entities is faster.** One request reads all edited entities and any visibility changes without computing selection outlines.
