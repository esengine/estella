---
section: Fixed
commits:
  - fix(runtime): refresh the entry scene after a manifest update
---
**Packaged games use the updated entry scene after a hot update.** Startup and scene reload use the current scene document when it differs from the file read during startup.
