---
section: Fixed
commits:
  - fix(editor): refresh HLOD proxies when source assets change
---
**The HLOD panel notices edits to source meshes and prefabs.** It reloads affected geometry, updates triangle counts, and marks the proxies that use those assets as out of date.
