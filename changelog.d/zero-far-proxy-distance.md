---
section: Fixed
commits:
  - fix(world): honor zero far distance and clear proxy failures
---
**A far proxy distance of zero turns off proxies in Play and exports.** Near cells still stream, and exports skip the unused proxy meshes. Clearing a world also clears proxy failures so the same manifest can retry when reused.
