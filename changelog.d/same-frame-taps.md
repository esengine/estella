---
section: Fixed
commits:
  - fix(ui): taps that land and lift within one frame are each a click
---
**Quick taps on a slow frame are no longer lost.** When a touch screen reported several whole taps before the game drew its next frame, and the platform gave them the same touch id (WeChat, mini-game hosts and browsers often do), only the last one reached the UI: tapping three buttons quickly during a long frame could select one. Each tap is now a press, a release and a click of its own, in the order it happened.
