---
section: Fixed
commits:
  - fix(editor): return toolbar dropdown focus to its trigger
  - fix(project): ship consistent toolbar dropdown focus
---
**Toolbar dropdowns return keyboard focus to their button on Escape or selection.** An action that focuses another control keeps that focus.
