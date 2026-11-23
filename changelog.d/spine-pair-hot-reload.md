---
section: Fixed
commits:
  - fix(spine): share skeleton acquisitions and reload changed binary sources
---
**Spine animations pick up edits to binary skeletons as well as atlases.** The typed loader and the Spine API share one read of the same skeleton and atlas. A new load after an edit receives the updated animation data even when the previous download is still running. Scenes and plugins holding the earlier version can finish using it.
