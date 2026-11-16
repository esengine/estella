---
section: Changed
commits:
  - perf(sdk): the bundled SDK carries its shader text without comments or indentation - a fifth of index.bundled.js was the built-in GLSL and WGSL as written; the build strips each shader template's comments and indentation, keeping every line break so a compile error names the same line, and a full bundle is 156 KB smaller (46 KB gzipped). The two shaders made by editing Model's text match its lines whatever their indentation, and the SDK suites run on the stripped text
---
**Games download less shader text.** The SDK's built-in shaders ship without their comments and indentation: a full SDK bundle is 156 KB smaller (46 KB gzipped) and a blank mini-game package 16 KB. Every line break is kept, so a shader compile error still names the line it did.
