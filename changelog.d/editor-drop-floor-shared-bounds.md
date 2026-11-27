---
section: Changed
commits:
  - perf(editor): reuse mesh bounds when dropping a selection to the floor
---
**Drop to Floor is faster on large selections.** The editor reads each mesh's bounds once per command and reuses them to find the support under every selected object.
