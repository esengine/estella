---
section: Fixed
commits:
  - fix(editor): preserve wheel positions in Play input and recordings
---
**Play input and recordings can scroll at an explicit canvas position.** Supply `pointerX` and `pointerY` to `play_input` or a `record_play` wheel event so each event reaches the control under its own position, even when several events share a frame.
