---
section: Fixed
commits:
  - fix(scene): share authored hierarchy checks across load and export
  - fix(editor): reject ambiguous scene hierarchies before projection
---
**Scene opens and exports report duplicate IDs and parent cycles.** The editor, asset cook, and prefab expansion check the authored hierarchy before filtering or expanding it. A rejected open keeps the current scene in place.
