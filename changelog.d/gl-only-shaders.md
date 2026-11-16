---
section: Changed
commits:
  - perf(export): a package that never draws through WebGPU ships its shaders without their WGSL - every built-in shader carried a WGSL twin a mini-game, a playable and a web build left on WebGL never read; the export cuts those sections from the SDK it bundles, and the shaders made by editing Model's text skip their WGSL edits where there is none. The cyber-rooftop example's web package is 131 KB smaller (19 KB gzipped) and hands WebGL the same GLSL, source for source
  - fix(export): the GL-only shader filter asks the path sandbox whether a module is the SDK's - a prefix test missed an SDK reached through a link and is the idiom the sandbox gate refuses
---
**Mini-games and WebGL web builds ship no WGSL.** Every built-in shader carries a WebGPU (WGSL) copy, and a package that never draws through WebGPU (any mini-game or playable, and a web build whose backend is WebGL) now leaves it out: the cyber-rooftop example's package is 131 KB smaller, 19 KB gzipped. A web build set to WebGPU keeps both, since it falls back to WebGL where the machine has no WebGPU.
