---
section: Fixed
commits:
  - fix(editor): show authored flipbook crops in previews and new sprites
  - fix(animation): share flipbook frame image regions with the editor
---
**Cropped Flipbook frames preview the same image region as playback.** The canvas, frame strip and scene view use the authored crop. Dragging a clip into the scene also seeds the new sprite with the first frame's own texture and crop.
