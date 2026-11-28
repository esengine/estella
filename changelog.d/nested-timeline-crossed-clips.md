---
section: Fixed
commits:
  - fix(animation): dispatch cues from nested clips crossed between frames
---
**Short nested timeline clips emit their cues even when a frame crosses the whole clip.** Markers, events, and particle cues follow forward and backward traversal, while property and camera sampling use the layers active at the frame’s final time.
