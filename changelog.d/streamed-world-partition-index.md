---
section: Changed
commits:
  - perf(world): index scene hierarchy and cell placement together
---
**Large streamed worlds partition faster.** The editor, Play, and the build pipeline use one entity index for hierarchy, residency, and reference checks, producing the same cell documents and manifest.
