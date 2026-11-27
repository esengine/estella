---
section: Fixed
commits:
  - fix(world): stop superseded residency reconciliations
---
**World streaming honors the newest source positions when a host callback triggers another update.** A previous update can no longer clear the new cell's urgent status or release the streaming hold early.
