---
section: Fixed
commits:
  - perf(editor): reuse Flipbook frame boundaries during playback
---
**Flipbook playback and scrubbing share the viewport’s frame boundaries.** The panel reuses timing data between frames, applies edits to frame durations immediately, and stops on the last frame when looping is turned off.
