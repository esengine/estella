---
section: Fixed
commits:
  - fix(camera): commit the view drawn by manual screen refreshes
---
**Paused viewport redraws update picking and overlays.** A manual screen draw publishes the camera and its render origin after the frame finishes. Texture previews leave the presented camera intact, and overlays are notified when the last screen camera disappears.
