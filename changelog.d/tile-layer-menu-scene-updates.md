---
section: Changed
commits:
  - perf(editor): filter tile layer menu updates by scene changes
  - perf(project): ship targeted tile layer menu updates
---
**The open tile layer menu skips unrelated component edits.** Moving or editing other objects in a large scene no longer rebuilds the menu on every edit. Layer names, order, visibility, lock state, and opacity still update as they change.
