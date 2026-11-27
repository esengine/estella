---
section: Fixed
commits:
  - fix(scene): share prefab member ID allocation with the editor
  - fix(editor): reserve scene reference IDs during prefab expansion
---
**Opening a prefab scene keeps existing references pointed at their original targets.** The editor and runtime skip scene IDs already named by parent links or entity fields when assigning IDs to prefab members, so a missing target cannot accidentally become a prefab child.
