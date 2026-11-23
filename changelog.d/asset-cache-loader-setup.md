---
section: Fixed
commits:
  - fix(assets): preserve ownership during cache loads and texture teardown
---
**Asset requests made during loader setup share one load.** A hot reload started by a loader keeps its replacement asset. Overlapping texture requests and scene unloads now return each native texture reference once, including when a sprite or material reuses a resident texture.
