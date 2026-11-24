---
section: Fixed
commits:
  - fix(assets): retain audio and prefab files for live component fields
---
**Persistent entities keep their loaded audio and prefabs across scene changes.** An audio source can reuse its buffer
even with a zero-byte cache budget. Tooltips and breakable objects can instantiate their prefabs without reading the
file again. Clearing the last field releases the entity’s hold. Headless hosts can also load these files and JSON before
initializing graphics.
