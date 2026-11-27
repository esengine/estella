---
section: Fixed
commits:
  - fix(editor): serialize terrain saves with project handoff
---
**Terrain saves stay with their project.** The editor finishes writing ordinary and tiled terrain saves before a project switch. A queued save whose terrain has already been replaced is canceled before writing any files.
