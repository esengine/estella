---
section: Fixed
commits:
  - fix(editor): preserve nested field edits in Play and scene writes
---
**Play keeps nested property edits without copying neighboring values.** Editing one vector axis through automation preserves the running values on the other axes. Keeping a nested change writes only that field back to the scene.
