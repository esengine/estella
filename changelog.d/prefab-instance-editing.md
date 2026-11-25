---
section: Fixed
commits:
  - fix(editor): keep prefab instances linked through scene edits
  - fix(prefab): preserve instance identity across editor operations
---
**Duplicated and restored prefab instances keep their link to the source asset.** Duplicating a whole instance or pasting it into another scene preserves its overrides and lets it receive later prefab edits. Undoing a deletion and returning from Play also preserve that link. Copying only a child into an instance gives it a new local identity, so the original and the copy can be edited independently.
