---
section: Fixed
commits:
  - fix(editor): preserve authored draw order when inserting prefab subtrees
---
**New prefab instances draw in the same order as the saved scene.** The viewport preserves the file order even when a child is listed before its parent. Deep hierarchies can be inserted without overflowing the call stack, and a cyclic insertion leaves the current scene intact.
