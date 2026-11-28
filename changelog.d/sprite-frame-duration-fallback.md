---
section: Fixed
commits:
  - fix(animation): share sprite frame duration validation
  - fix(editor): share sprite timing with the engine
---
**Invalid Sprite frame durations now use the clip’s default timing.** Flipbook playback, Sequencer frame markers, and the runtime use the same duration rule, while preserving valid per-frame overrides and each clip’s default frame rate.
