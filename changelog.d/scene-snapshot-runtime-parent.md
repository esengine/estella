---
section: Fixed
commits:
  - fix(scene): keep saved hierarchy links consistent across runtime edits
---
**Scene snapshots keep valid parent and child links when an engine system moves entities at runtime.** A saved entity whose parent exists only at runtime becomes a scene root, with its own children still attached.
