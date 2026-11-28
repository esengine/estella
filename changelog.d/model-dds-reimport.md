---
section: Fixed
commits:
  - fix(import): keep external DDS files for model reimport
---
**Imported models keep their external DDS textures when reimported.** The source textures now travel with the model into the project, so changing import settings still regenerates the PNG textures used by scenes and exports.
