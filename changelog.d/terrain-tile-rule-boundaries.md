---
section: Fixed
commits:
  - fix(tilemap): bound terrain rules to available tile IDs
  - fix(editor): keep terrain brushes inside their tileset
---
**Terrain brushes pick tiles that are still available.** The editor's edge and Wang brushes skip rules for missing atlas cells and tiles belonging to another palette slot. Runtime peering also respects the tileset's declared tile count.
