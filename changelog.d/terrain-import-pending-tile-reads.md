---
section: Fixed
commits:
  - fix(terrain): keep imported heights when pending tile reads finish
---
**Tiles loading in the background keep the imported heights.** When an earlier tile read finishes after a heightmap import,
the preview uses the committed heights for that tile. Imports of loaded tiles still leave other tiles alone.
