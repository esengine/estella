---
section: Added
commits:
  - feat(render): Cluster LOD keeps every triangle of a dense static mesh and draws the clusters a view can tell apart
---
**A dense static model can keep every triangle and be drawn with only the ones a view can tell apart.** Tick **Cluster LOD** in a model's import settings and each static mesh is cut into clusters of up to 128 triangles at every level of detail. Each frame, every part of the mesh is drawn from the level whose error is under a pixel from where the camera stands, with no seam where two levels meet and no `LODGroup` to set up; shadows use the same triangles. A mesh of two million triangles bakes in about five seconds and is drawn with about a thousand from far away. The `.esmesh` grows by about the size of its index data. Skinned and morphing meshes, and meshes placed through `MeshInstances`, are drawn whole as before. `render.cluster.triangles` and `render.cluster.sourceTriangles` in the frame counters say what was drawn of what the meshes have. An `.esmesh` without clusters is written byte for byte as it was.
