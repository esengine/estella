---
section: Changed
commits:
  - perf(editor): plan tile replacements directly from chunks
  - perf(project): ship faster tile replacement previews
---
**Tile replacement previews are faster on large maps.** The editor reads matching cells directly from decoded chunks and skips
missing chunks where the selection only replaces existing tiles.
