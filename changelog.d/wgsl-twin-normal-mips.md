---
section: Fixed
commits:
  - fix(shaders): a GLSL shader's sampleNormal reads the normal map through its mips on WebGPU too - the transpiler wrote it as the WGSL header's level-0 read, so every built-in lit shader written in GLSL alone sampled the full-size normal map at any distance; in a fragment it now goes through sampleNormalGrad with the derivatives of its uv, as GLSL's texture() does
---
**On WebGPU, a distant normal-mapped surface no longer shimmers.** Model and the other built-in lit shaders written in GLSL alone read their normal map at full size however far away the surface was, so its fine detail sparkled from pixel to pixel; it is now read through the map's smaller copies, as on WebGL.
