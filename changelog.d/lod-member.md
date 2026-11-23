---
section: Added
commits:
  - feat(render): LODMember makes levels of whole entities, chosen per view by an LODGroup, and a groom's strands and cards use it
  - fix(editor): the groom check reads the level the renderer chose for the game camera's view
---
**Levels of detail that are whole entities, chosen per view.** A new `LODMember` component draws its MeshRenderer only
while another entity's `LODGroup`, as each view measures it, is at its `level`: for levels that differ in more than their
mesh, such as several meshes with materials of their own against one cheaper stand-in. The renderer chooses once per
view per frame for the whole group, as it does for an LODGroup's own meshes, so every member agrees, a split screen or a
minimap chooses for itself, a shadow follows what its view drew, the quality's LOD distance scale applies, and the
editor's LOD inspection reads it. A groom with cards now switches this way: its strands and its cards are members of a
group the Groom component makes, in place of a choice made in script against one camera.
