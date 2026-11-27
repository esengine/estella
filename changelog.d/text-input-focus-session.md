---
section: Fixed
commits:
  - fix(ui): isolate text editor callbacks across focus sessions
---
**Returning to a text field starts from its committed value.** Input and IME callbacks from an earlier focus session are discarded even when focus leaves and returns between game frames.
