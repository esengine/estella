---
section: Added
commits:
  - feat(render): run native and web rendering on a dedicated CPU thread
---
**Native and web games can render on a dedicated CPU thread.** Enable `features.rendering.threadedRendering` in the project. Native hosts render and present on a dedicated thread. Web exports ship a worker-enabled core for WebGL2 and WebGPU and use the regular core on pages without cross-origin isolation or transferable canvases. The SDK exposes CPU render fences for tracking submitted work and draining deferred resource releases.
