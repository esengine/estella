---
section: Changed
commits:
  - feat(editor): the selection outline is the engine's, drawn on the GPU
  - perf(render): a frame waits for the GPU to finish the last, and the engine outlines the editor's selection
---
**A selected mesh is outlined by the engine, as Unreal outlines it, and selecting no longer slows the viewport.** The orange outline is drawn on the GPU round the selected meshes' shape: full strength where they are in sight, faint where something opaque stands in front, nothing over the mesh itself. Selecting a detailed mesh used to drop the viewport to about 20 fps while the editor traced its edges every frame; the cost is now the selection's draws and one screen pass, whatever the detail. Skinned meshes keep the editor's own outline for now.
