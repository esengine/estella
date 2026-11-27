---
section: Fixed
commits:
  - fix(world): finish discarding before preparing a cell again
---
**A world cell requested while its prefetch is being discarded prepares again before publication.** Clearing the world from the discard callback also waits for the cell's release to finish.
