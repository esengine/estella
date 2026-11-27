---
section: Fixed
commits:
  - fix(editor): project tile painting onto the rendered layer plane
---
**Tile painting follows the drawn layer in an angled view.** Picking, visible grid bounds, and selection use the renderer's depth, including with a rebased origin. Grid outlines project the actual cell corners when the camera skews them on screen.
