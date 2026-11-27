---
section: Fixed
commits:
  - fix(tilemap): resolve relative atlases in native tilesets
  - fix(editor): preview relative native tileset atlases
---
**Native tilesets can reference an atlas relative to their `.estileset` file.** The painter, tileset editor, collision preview, and runtime use the same path rules. Exported tilesets retain the atlas after staging changes their location.
