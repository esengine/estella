---
section: Added
commits:
  - feat(editor): drag an image, mesh, flipbook or tileset onto the Outliner to create it there
---
**Drag assets into the Outliner to create entities.** The Outliner took only prefabs, and every other asset dragged into
it did nothing. It now makes the same entities the scene view does: an image becomes a sprite, a mesh a model, a
flipbook an animated sprite, a tileset a tilemap, and a prefab an instance. Dropped on a row it is created as that
entity's child, at the parent's origin; dropped on the empty space under the rows, at the scene root.
