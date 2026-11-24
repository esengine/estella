---
section: Fixed
commits:
  - fix(events): honor subscriptions cancelled during dispatch
---
**A listener disconnected in the callback that registered it stays disconnected.** Nested queries see new listeners once the outer dispatch returns. Existing subscriptions follow a signal or registry when it moves.
