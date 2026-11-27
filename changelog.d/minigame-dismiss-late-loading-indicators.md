---
section: Fixed
commits:
  - fix(minigame): dismiss late loading indicators independently
---
**Mini-game loading indicators no longer leave the first screen covered when an earlier host call fails or misses its callback.** A loading indicator that appears late and reports completion is dismissed after startup ends.
