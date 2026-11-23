---
section: Fixed
commits:
  - fix(net): reconcile received component baselines across joins and reconnects
---
**Joining or reconnecting a multiplayer game now restores the components the server actually sent.** Returning players keep their local appearance and lose effects removed while they were away. Prediction preserves client-only components and starts from the last received fields. Players joining between fixed ticks also receive corrections for temporary values or components they saw, with state updates respecting their bandwidth budget.
