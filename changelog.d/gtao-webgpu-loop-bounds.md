---
note: Global Illumination & Occlusion and Reflections hold the samples, steps, grids and bakes those effects spend.
commits:
  - fix(render): GTAO draws on WebGPU again - its slice and step bounds are constants the WGSL translator takes, as the other GI and reflection shaders' already were, where a #define left the pass with no WGSL and the frame black; the voxel GI fallback's bounce bound follows, and the test that transpiles every fullscreen pass now reads the GTAO, subsurface and voxel fallback passes too
---
