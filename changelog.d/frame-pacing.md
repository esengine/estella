---
section: Fixed
commits:
  - perf(render): a frame waits for the GPU to finish the last, and the engine outlines the editor's selection
---
**A character no longer keeps moving after its key is let go.** When the GPU fell behind, the app queued frame after frame ahead of it, so input showed up several frames late: release D and the character took another step. The loop now starts no new frame while the GPU is still on the last one, on WebGL and WebGPU alike, so what is drawn is never more than a frame behind the keys.
