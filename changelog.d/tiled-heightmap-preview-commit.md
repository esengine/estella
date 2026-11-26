---
section: Fixed
commits:
  - fix(editor): update imported terrain previews after writing images
  - fix(terrain): prepare tiled heightmap imports before editing the ground
---
**The terrain preview changes after a heightmap import is saved.** A failed encode or file write leaves the tiles and overview
displayed in the editor at their previous heights.
