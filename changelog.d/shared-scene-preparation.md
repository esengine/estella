---
section: Fixed
commits:
  - fix(scene): share and retire in-flight scene preparations
---
**Overlapping requests to prepare and load the same scene now share its assets.** Discarding a streamed preparation also works while it is waiting for a frame or reading an asset. Unloading and immediately reloading a scene keeps later callers attached to the new load.
