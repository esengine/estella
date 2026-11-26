---
section: Fixed
commits:
  - fix(persist): queue world restores with saves and stage reads before applying
---
**World restores finish reading before applying saved entities.** A read failure leaves the world untouched, and a save requested during a restore waits for the restore to finish.
