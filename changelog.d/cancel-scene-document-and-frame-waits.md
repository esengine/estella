---
section: Fixed
commits:
  - fix(scene): cancel pending document and frame budget waits
---
**Canceled runtime scenes leave pending document and frame budget waits promptly.** A discarded preparation exits while its scene file is still being fetched or its next turn has yet to arrive. Late results cannot advance the canceled scene to the next phase.
