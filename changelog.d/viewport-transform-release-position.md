---
section: Fixed
commits:
  - fix(editor): commit viewport transforms at the release position
  - fix(project): ship accurate viewport transform release positions
---
**Viewport transforms follow the pointer all the way to release.** Move, rotate, and scale use the release position even if the final move event is missed. Releasing after dragging across overlapping objects also avoids cycling the selection.
