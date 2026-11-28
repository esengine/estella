---
section: Fixed
commits:
  - fix(editor): restore sprite pose when a flipbook becomes empty
---
**Removing the last flipbook frame restores the sprite's scene appearance in the viewport.** The last animated frame clears immediately, and undoing the deletion resumes the preview.
