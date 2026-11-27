---
section: Fixed
commits:
  - fix(terrain): reject mismatched height tiles during asset cooking
---
**Builds report PNG height tiles that do not match the terrain grid.** The asset cook reports the terrain, tile coordinate, and actual and required dimensions before shipping a tile the runtime would reject.
