---
section: Fixed
commits:
  - fix(minigame): stage colliding scene files at distinct paths
---
**Mini-game export handles scene file and folder name collisions.** Scenes such as `chapter` and `chapter.json/room` can ship together and remain available under their original names.
