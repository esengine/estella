---
section: Fixed
commits:
  - fix(editor): keep new material shader and parent links through moves
---
**New material links follow indexed shaders and parents when they move.** The Shader picker, Convert to Unique Shader, and Create Material Instance store the asset identity so a rename or folder move keeps the link working.
