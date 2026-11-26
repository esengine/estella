---
section: Changed
commits:
  - perf(scene): reuse privately parsed scene documents during preparation
---
**On-demand scenes prepare without copying the document a second time.** The runtime reuses the private result of parsing a scene file and still protects authored data supplied by the caller.
