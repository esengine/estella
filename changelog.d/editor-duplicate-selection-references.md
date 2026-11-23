---
section: Fixed
commits:
  - fix(editor): preserve entity references across selection copies and undo
---
**Duplicating a selection keeps its internal links connected to the copies.** A skinned mesh and its selected skeleton, linked UI controls, and references declared by project scripts can be copied together. Each duplicated root keeps its parent. Undo and redo preserve the pasted hierarchy even when a child was selected first. Deleting a target clears its live references in the viewport, and undo reconnects them to the restored target.
