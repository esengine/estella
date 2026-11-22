---
section: Added
commits:
  - feat(render): schedule eligible GPU compute jobs on an independent Metal queue
---
**GPU compute jobs can overlap independent graphics passes on Metal.** Enable `asyncCompute` in the app options or set `Renderer.consoleVariables['r.rdg.asynccompute']` to `1` at runtime. The render graph waits before consuming a result. Devices with a single queue run the same dispatches inline.
