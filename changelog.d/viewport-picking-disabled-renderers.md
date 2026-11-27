---
section: Fixed
commits:
  - fix(picking): use visible renderer geometry for world clicks
  - fix(editor): keep drawn icons pickable on hidden renderers
---
**Hidden renderer components no longer intercept viewport clicks.** A disabled mesh, sprite or shape leaves other visible components on the same entity selectable. Visible editor icons, such as cameras, remain clickable.
