---
section: Fixed
commits:
  - fix(picking): honor the presented camera sorting-layer mask
  - fix(editor): pick world geometry through the presented camera mask
---
**Viewport clicks respect the camera's sorting-layer mask.** A mesh, sprite or shape culled by the camera no longer intercepts clicks. Playback uses the same camera and mask that drew the most recent frame, including when a sorting group overrides a member's layer.
