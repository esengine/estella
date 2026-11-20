---
section: Added
commits:
  - feat(render): a compute skin cache poses each skinned mesh once a frame for every pass that draws it
  - feat(editor): skin cache settings in Project Settings, and Skin Cache Usage on MeshSkin
  - fix(render): the skin cache builds where GPU particles are not compiled in
  - fix(render): the skin weights view poses its mesh in the vertex stage, not through the skin cache
---
**Skinned meshes are posed once a frame, not once per pass.** On WebGPU, a compute pass now poses each skinned mesh once, before the frame's passes. Its shadow cascades, depth prepass and colour pass then draw the posed vertices as plain geometry instead of each posing them again, and a mesh split into bone chunks is drawn in one draw. WebGL2 has no compute shaders, so it poses skins in each draw as before. Morph-target meshes and the motion-vector pass also still pose in the vertex stage.

Three new settings in **Project Settings > Rendering > Skinning**:
- **Support Compute Skin Cache** turns the cache on or off.
- **Default Skin Cache Behavior** chooses which meshes use it. *Inclusive* means every mesh unless it opts out; *Exclusive* means none unless it opts in.
- **Maximum memory for Compute Skin Cache per world (MB)** caps its memory. The default is 128 MB. Meshes are admitted first come, first served, and a mesh that would exceed the cap is posed in each draw instead.

Each mesh can opt in or out with **Skin Cache Usage** (Auto, Disabled, Enabled) on its MeshSkin component. All of these apply in the viewport at once and are carried into exported games.
