---
section: Fixed
commits:
  - fix(assets): ship bitmap font wrapper metrics and page textures
---
**Bitmap font wrappers keep their metrics and textures in exported games.** The asset scan follows the metrics field that preview loads for each wrapper format. Repeat scans reuse the page list for unchanged bitmap font metrics files.
