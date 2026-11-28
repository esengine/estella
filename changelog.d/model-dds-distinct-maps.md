---
section: Fixed
commits:
  - fix(import): keep same-named model textures distinct
---
**Models keep distinct DDS textures that share a filename.** Textures from different folders get stable PNG product names, so their materials keep the right pixels after reimport and export.
