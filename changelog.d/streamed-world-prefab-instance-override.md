---
section: Fixed
commits:
  - fix(world): read streamed world settings from prefab instance overrides
---
**A prefab instance can declare streaming from its root.** Play preview, export, and export target checks now recognize a StreamedWorld component added through a scene's prefab instance overrides.
