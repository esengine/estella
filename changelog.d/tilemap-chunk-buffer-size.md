---
section: Fixed
commits:
  - fix(tilemap): validate chunk dimensions and input length before uploading
---
**Chunk uploads validate the supplied tile rows.** Invalid dimensions and incomplete buffers leave the existing chunk intact. A complete buffer uploads only the tiles covered by its declared dimensions.
