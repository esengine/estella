---
section: Fixed
commits:
  - fix(assets): release addressable groups by their acquired receipts
---
**Releasing an asset group gives back the resources that load acquired.** `releaseGroup(name)` releases one outstanding bundle even after a manifest update, while independently held assets stay live. Use `bundle.release()` to select a particular load of the same group.
