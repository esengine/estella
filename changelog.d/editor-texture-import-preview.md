---
section: Fixed
commits:
  - fix(editor): reload texture import edits with their dependent materials
  - fix(editor): keep texture import previews consistent with exported scenes
---
**Texture import edits now update the open scene as soon as the replacement is ready.** Sprites, meshes and materials keep drawing during the reload, then use the saved filter, wrap and mipmap settings. Changing or clearing a nine-slice border updates sprites and UI panels. Applying two different settings to the same texture at the same time preserves both edits.
