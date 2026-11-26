---
section: Fixed
commits:
  - fix(editor): bind tile layer drag ordering to the original layer
  - fix(project): ship stable tile layer drag ordering
---
**Tile layer drags keep their original source.** Changes to the layer list during a drag no longer move a different layer.
The drop marker shows the insertion side, and changing scenes discards the pending drag.
