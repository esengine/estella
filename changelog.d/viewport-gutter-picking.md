---
section: Fixed
commits:
  - fix(editor): keep world picking inside the drawn viewport
---
**World selection respects preview gutters.** Clicks in the gutters outside the drawn camera viewport no longer select world objects in Edit or Play. A marquee that crosses a gutter selects objects through its overlap with the picture.
