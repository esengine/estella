---
section: Changed
commits:
  - perf(animation): reuse the active Animator state path within each update
---
**Animator updates do less work when many entities share a controller.** Advancing a layer and checking its transitions now reuse the same resolved state path.
