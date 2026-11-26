---
section: Fixed
commits:
  - fix(runtime): keep pending asset paths in authored snapshots
---
**Inspection and scene snapshots retain the selected asset while it loads.** An in-flight texture or mesh path is shown and saved until its handle is ready or a newer edit replaces it.
