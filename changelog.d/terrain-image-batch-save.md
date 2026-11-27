---
section: Fixed
commits:
  - fix(editor): save ordinary terrain images as a batch
---
**Terrain height and paint images save together.** Ordinary terrain saves use the same rollback mechanism as tiled terrain saves. An interrupted batch keeps the previous files and leaves the edit available to retry.
