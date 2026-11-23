---
section: Fixed
commits:
  - fix(native): use the engine texture cache on supported hosts
---
**Native games can reuse recently released textures within their configured cache budget.** A file edit clears the old lookup so the next load receives its replacement. Memory-pressure trimming also reaches the native texture pool.
