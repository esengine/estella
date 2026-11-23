---
section: Fixed
commits:
  - fix(assets): isolate resident textures and restore them through their owner
---
**Asset loaders sharing a graphics device can load the same texture path with different content, color spaces and resolutions.** Each loader can reuse and invalidate its own cached texture. After the device recovers, held textures regain their pixels at the resolution they had before the loss.
