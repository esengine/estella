---
section: Changed
commits:
  - perf(editor): prune floor support searches for large selections
---
**Drop to Floor searches nearby supports when moving large selections.** It uses the same scene snapshot and still lands each selected subtree on its highest eligible support.
