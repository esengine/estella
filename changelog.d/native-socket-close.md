---
section: Fixed
commits:
  - fix(native): retire socket resources before reporting closure
---
**Native WebSocket connections release their transport before delivering the final close event.** Linux clients can finish a secure exchange and exit cleanly.
