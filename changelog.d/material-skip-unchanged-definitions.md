---
section: Changed
commits:
  - perf(material): keep unchanged render state during parameter edits
---
**Parameter-only material edits reuse the current render state.** The runtime still rebuilds material state when a parameter is removed, the shader changes, or the renderer reconnects.
