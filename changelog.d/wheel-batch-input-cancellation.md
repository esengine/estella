---
section: Fixed
commits:
  - fix(ui): stop a wheel batch when input is cancelled
---
**Cancelling input stops queued UI scrolling immediately.** If a scroll listener pauses the app or the window loses focus, the remaining wheel samples are discarded and a later wheel gesture starts fresh.
