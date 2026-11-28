---
section: Fixed
commits:
  - fix(timeline): project sprite frames from nested sequence clips
---
**Sprite frame tracks work inside nested timeline clips.** They sample the child clip’s own clock and textures, keep the last active track on a shared target, and apply held images to replacement Sprites with a full texture window.
