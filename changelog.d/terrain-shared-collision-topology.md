---
section: Changed
commits:
  - perf(terrain): reuse render patch topology when building collision tiles
---
**Ground and planet collision tiles build faster.** Rendering and physics share the same triangle layout, and collision tiles reuse its index pattern when nearby terrain streams in or rebuilds.
