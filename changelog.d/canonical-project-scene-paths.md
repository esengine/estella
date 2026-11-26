---
section: Fixed
commits:
  - fix(export): resolve scene names from canonical project paths
---
**Exports resolve scene names and exclusions from the same project-relative paths.** Windows separators, dot segments and a trailing separator on the scenes directory no longer change startup names or reintroduce excluded scenes.
