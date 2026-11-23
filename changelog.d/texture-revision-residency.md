---
section: Fixed
commits:
  - fix(assets): publish texture residency only for the current file revision
---
**Editing a texture while it decodes now gives subsequent sprite and material loads the updated pixels.** The earlier request can finish using its original image. Releasing both requests returns both GPU references, whichever decode finished first.
