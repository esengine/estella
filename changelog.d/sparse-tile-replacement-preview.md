---
section: Changed
commits:
  - perf(editor): scan occupied chunks for tile replacement previews
---
**Tile replacement previews skip empty space when replacing existing tiles.** Large sparse selections scan only the stored chunks inside the selection and keep the same preview order and tile flags.
