---
section: Fixed
commits:
  - fix(assets): preserve mesh, font and lighting bindings across updates
---
**Updating a mesh, font, environment or light probe volume now changes only objects that reference that asset.** Two assets with identical cooked content can share a download and still update independently. Asset groups now preload meshes and baked lighting. Bitmap fonts resolve their metrics and pages from the authored location and release their page textures when the last user releases the font.
