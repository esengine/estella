---
section: Fixed
commits:
  - fix(tilemap): preserve painted layers when a chunk import fails
---
**A damaged tilemap save preserves the tiles already on the layer.** An incomplete map or an unsupported tile ID leaves painting, collision and edit revisions intact. A valid save can then be loaded into the same layer.
