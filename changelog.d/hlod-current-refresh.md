---
section: Fixed
commits:
  - fix(editor): keep HLOD results with the current refresh and project
---
**The HLOD panel keeps the latest refresh and clears when switching projects.** Slow mesh reads and builds can no longer replace newer rows or restore a previous project's proxy and viewport selection.
