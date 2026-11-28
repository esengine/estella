---
section: Changed
commits:
  - perf(assets): reuse preload plans for repeated refs
---
**Preloading repeated asset references reuses their loading plan.** Within one explicit preload list, repeated references share path, type, and package lookup work while each occurrence still reports progress and retains its own reference.
