---
section: Fixed
commits:
  - fix(ui): project the IME anchor from the world caret
---
**IME candidate windows follow the caret on 3D text inputs.** The input surface uses the rendered caret's depth and the field's transform when positioning the candidate window under a perspective camera.
