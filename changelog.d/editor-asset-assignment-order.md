---
section: Fixed
commits:
  - fix(editor): record asset assignments before loading their previews
  - fix(editor): keep asset drops and undo in the order they were made
---
**Asset slots keep your latest choice when previews load slowly.** Dropping a texture or a mesh, replacing it and clearing the slot now produces three separate undo steps. Saving records your selection immediately. A mesh dropped into the viewport goes straight to the mesh loader.
