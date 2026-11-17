---
section: Fixed
commits:
  - fix(shaders): a Lit shader written in GLSL alone hands the WGSL header the varyings its GLSL reads straight - the transpiled entry sets g_probeSlot, g_lightmap and g_worldTangent from VSOut, as the hand-written twins did, so on WebGPU a Model surface shows its lightmap, a mesh's own tangents orient its normal map, and each instance reads its own light probes
---
**On WebGPU, a Model material shows its baked lightmap and lights its normal map with the mesh's own tangents again.** Since Model and the other built-in lit shaders became GLSL alone, with their WebGPU code written as they compile, that code no longer told the lighting where the surface sat in the lightmap, which tangent frame the mesh carried, or which instance's light probes to read: a baked surface drew as if it had no bake, a normal map lit from the frame worked out per pixel instead of the imported tangents, and every instance read the first one's probes. WebGL was not affected.
