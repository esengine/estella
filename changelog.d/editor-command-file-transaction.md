---
section: Fixed
commits:
  - fix(editor): await asynchronous command writes before closing undo steps
---
**Saving painted terrain keeps its weight map and undo record together.** Editor command callers now wait for asynchronous writes to finish. Saving through the command interface records the changed files in the same undo step as the scene edit.
