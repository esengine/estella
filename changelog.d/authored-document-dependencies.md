---
section: Fixed
commits:
  - fix(editor): import external Tiled tilesets as JSON sources
  - fix(assets): resolve document dependencies from their authored location
---
**Tiled maps and 3D materials keep their intended textures when exported.** The editor imports external Tiled tilesets (`.tsj`), and builds include their grid images and individual tile images. References to a sibling file resolve beside the document that names it, including when the project root contains a different texture with the same name.
