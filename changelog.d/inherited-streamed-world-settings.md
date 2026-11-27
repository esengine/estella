---
section: Fixed
commits:
  - fix(world): resolve inherited streamed world settings across preview and export
  - fix(editor): read resolved world settings for HLOD clusters
---
**Streamed worlds can inherit their settings from a prefab root.** Play, export, and editor HLOD tools use the prefab's settings after variant and scene instance overrides. Removing the component from the instance turns off its declaration.
