---
section: Fixed
commits:
  - refactor(render): share parallax offsets with viewport handles
  - fix(editor): align sprite rect handles with parallax
---
**Sprite pivot and Rect grips follow the displayed sprite.** Dragging a grip translates the pointer back into the authored sprite coordinates, preserving the stationary edge or artwork while the camera applies parallax.
