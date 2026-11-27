---
section: Fixed
commits:
  - fix(input): use browser wheel coordinates before pointer motion
---
**The first wheel gesture reaches the UI under the pointer.** Browser wheel events carry their canvas position, so a scroll view can respond even when the pointer has yet to move.
