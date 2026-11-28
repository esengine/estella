---
section: Fixed
commits:
  - fix(editor): find image references in unsaved scenes and prefabs
---
**Find Usages and delete confirmation recognize images in unsaved rich text.** They follow the same relative paths, path separators and filename suffixes as the asset scan. An unsaved prefab appears under its own name, and batch lookups build reverse edges only for the selected assets.
