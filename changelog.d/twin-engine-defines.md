---
section: Fixed
commits:
  - fix(shaders): a lit shader written only in GLSL is lit on WebGPU - its WGSL copy was translated with only the switches and features the shader declares, so a symbol the engine defines when it assembles the shader (MESH_NORMALS, ES_GBUFFER) took its undefined branch for good: a mesh read the flat 2D normal and drew one colour on WebGPU where WebGL shaded it. Every symbol the shader's GLSL tests is now a toggle of the translation, and a twin made before is made again
---
**A lit shader written only in GLSL is lit on WebGPU.** The WebGPU copy made for a shader you wrote in GLSL ignored what the engine switches on for a mesh (its normals, its surface output), so a lit mesh drew as one flat colour on WebGPU while WebGL shaded it. Copies made before are made again the next time the shader is served or exported.
