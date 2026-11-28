---
section: Fixed
commits:
  - fix(tilemap): keep Tiled animations and properties in direct imports
---
**Direct Tiled imports retain tile animations and custom properties.** Both loading paths install the same per-tile metadata. Imported animations advance in their own world and stop when their layer is removed.
