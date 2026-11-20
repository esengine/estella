---
section: Added
commits:
  - feat(render): Renderer.clusterInspect answers what the last frames drew of an entity's Cluster LOD mesh
  - feat(editor): the selection readout says how many of a Cluster LOD mesh's triangles the view drew
---
**The viewport says what a Cluster LOD mesh draws.** Select a mesh imported with Cluster LOD and the selection readout at the viewport's bottom left reads, for example, **8,512 of 9,216 tris drawn · 67 clusters**, following the camera as it moves; before, it showed only the mesh's own triangles, which such a mesh does not draw. A mesh without clusters keeps its plain count. `Renderer.clusterInspect(entity)` answers the same for a tool or a test.
