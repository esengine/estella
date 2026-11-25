---
section: Fixed
commits:
  - fix(project): keep startup and export scenes bound across asset moves
  - fix(editor): keep open documents and recovery bound across asset moves
---
**Moving a scene or prefab keeps the editor saving to its new location.** Renaming a file or moving its folder in the Content Browser preserves unsaved edits, undo history and crash-recovery snapshots. Sprites and meshes referenced by UUID resolve at their new paths immediately. The project startup scene, scene directory, build exclusions and workspace follow the move. In Prefab Mode, Back to Scene returns to the moved scene.
