---
section: Fixed
commits:
  - fix(runtime): scope input and visibility listeners to their game
---
**A replacement game keeps its controls when the previous game quits.** Keyboard, pointer, touch and gamepad input follow the active game. Each live game continues to pause and resume with its host. Repeated starts on older mini-game hosts reuse their foreground and keyboard listeners.
