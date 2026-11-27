---
section: Fixed
commits:
  - fix(input): reset gamepad button history on reconnect
---
**Gamepads start with fresh button history after reconnecting.** Cancelling host input also clears held buttons and axes until the next snapshot, so a neutral controller cannot report a release from its previous connection.
