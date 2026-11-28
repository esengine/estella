---
section: Fixed
commits:
  - fix(animation): preserve authored flipbook size for downscaled exports
---
**Exported flipbooks keep their authored frame sizes and anchors when Max Size reduces a texture.** Whole and cropped frames keep the geometry shown in the editor while the build ships the smaller texture.
