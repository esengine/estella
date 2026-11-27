---
section: Fixed
commits:
  - fix(editor): rank transparent built-in UI behind visible geometry
---
**Selection respects UI opacity.** Fully transparent built-in UI and text no longer take priority over scene geometry in Edit or Play. They remain available to selection cycling and the UI Debugger. Custom UI materials retain priority when their shader can paint independently of vertex alpha.
