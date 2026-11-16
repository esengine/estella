---
internal: The render host used by the pixel gates builds again; nothing a project can call or draw changes.
commits:
  - fix(render-host): the render host resolves esengine/wgsl - host.ts installs the transpiler from it, and the alias that maps esengine to the SDK's index file turned the subpath into a path under that file, so the host did not build
---
