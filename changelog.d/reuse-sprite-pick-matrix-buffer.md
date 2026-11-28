---
section: Changed
commits:
  - perf(picking): reuse sprite matrix scratch across bounds traversal
---
**Pointer and marquee selection need fewer engine heap allocations in sprite-heavy scenes.** Each bounds traversal reuses one temporary render-matrix buffer across parented sprites. Prefab framing uses the same buffer lifetime.
