---
section: Fixed
commits:
  - fix(scene): release canceled loads before shared asset preparation completes
---
**Canceling a preview no longer waits for its shared asset downloads.** A new preview can start immediately, and assets that finish later still serve other callers while the canceled scene releases its own references.
