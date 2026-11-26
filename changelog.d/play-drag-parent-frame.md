---
section: Fixed
commits:
  - fix(editor): use the full parent frame for Play dragging
---
**Play dragging follows the selected axis and depth under a tilted parent.** Moving a child uses the same parent transform as the editing viewport. Rotating or resizing an entity without a Transform leaves it alone.
