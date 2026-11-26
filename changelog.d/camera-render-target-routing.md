---
section: Fixed
commits:
  - fix(camera): keep render texture passes off the screen
---
**Render texture cameras keep their own output surfaces.** Releasing a texture stops its camera from drawing over the screen. Immediate frames preserve active texture targets, and single-camera previews use the preview surface's aspect ratio.
