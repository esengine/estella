---
section: Fixed
commits:
  - fix(editor): use declared tileset rows for atlas editing
---
**Tileset editing uses the same tile IDs as painting and play.** Collision, terrain and animation markers follow the asset’s declared columns and tile count even when the image has extra space. Thumbnails only sample complete tiles inside that range.
