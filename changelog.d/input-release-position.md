---
section: Fixed
commits:
  - fix(input): keep the mouse and touch release position
---
**Mouse and touch releases use their actual position.** Releasing away from a button no longer clicks it when the host omits a final move event. A press and release between frames keep their separate positions.
