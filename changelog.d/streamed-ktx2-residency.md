---
section: Fixed
commits:
  - fix(textures): stream authored KTX2 levels consistently across renderers
---

**Streamed KTX2 textures retain their colours down to the smallest preview.** Native builds now honour the requested size, and WebGPU draws a preview in RGBA when its size cannot form whole compression blocks. Built-in transcoders skip larger mip levels when loading a preview.
