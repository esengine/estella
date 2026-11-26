---
section: Fixed
commits:
  - fix(editor): keep prefab entity IDs stable across recovery and saves
  - fix(project): ship stable prefab recovery identities
---
**Prefab recovery copies and manual saves agree on new entity IDs.** Flat prefabs and variants keep the same IDs when you undo and redo an addition or retry a failed save, so recovery copies match the saved prefab when its contents are unchanged.
