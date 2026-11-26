---
section: Fixed
commits:
  - fix(runtime): scope device debug replies to their connection
---
**Device diagnostics stay in the correct editor session after reconnecting.** Late results from a disconnected session are discarded, and requests still waiting for the game to start are released on disconnect.
