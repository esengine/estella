---
section: Changed
commits:
  - perf(picking): reuse live hierarchy readers across hits
---
**Faster picking with camera layer filters.** Selection in scenes with nested sorting groups reuses the engine’s component readers while applying the current hierarchy and group settings to each hit.
